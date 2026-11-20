// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The better-auth endpoints eduLIMS closes: the ones that delete a user, write a user's roles or
// rename a user. eduLIMS does those itself (src/server/users/delete-user.ts, setLocalRoles and
// blockUser in src/server/users/actions.ts), and names come from the identity provider.
// Relative imports: `pnpm db:seed` loads auth.ts in plain Node.
import "@tanstack/react-start/server-only";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { auditRecorderOf, requestIdOf } from "../audit/better-auth-hooks.ts";
import { clientIpOf } from "../client-ip.ts";
import { RefusalDeduper } from "../scim/audit.ts";

/**
 * The better-auth paths that answer 404 over HTTP and on `auth.api`. The admin plugin's
 * `remove-user` deleted in separate statements before it checked the last-teacher rule, and the
 * core `delete-user` and its callback would let a user delete their own account (#318).
 * `set-role` and `update-user` wrote roles without the administrator locks and the
 * last-administrator rule, and the core `update-user` let any signed-in user rename themself
 * (#345).
 */
export const CLOSED_AUTH_PATHS = [
  "/admin/remove-user",
  "/admin/set-role",
  "/admin/update-user",
  "/delete-user",
  "/delete-user/callback",
  "/update-user",
] as const;

/**
 * The better-auth paths that answer 404 over HTTP only (`disabledPaths`), because the server
 * still calls them on `auth.api`: `create-user` for the seed and the tests, which pass no
 * session. Over HTTP `create-user` would let an administrator give any role, and `ban-user` would
 * block the last administrator past the rule blockUser holds (#356 review, S2 and S3).
 */
export const HTTP_CLOSED_AUTH_PATHS = ["/admin/ban-user", "/admin/create-user"] as const;

/** The activity-log reason of a call to a closed path. */
export const ENDPOINT_CLOSED = "endpoint_closed" as const;

function isClosed(path: string | undefined): boolean {
  return path !== undefined && (CLOSED_AUTH_PATHS as readonly string[]).includes(path);
}

function userIdOf(body: unknown): string | undefined {
  const value: unknown =
    typeof body === "object" && body !== null ? Reflect.get(body, "userId") : undefined;
  return typeof value === "string" && value.length > 0 && value.length <= 128 ? value : undefined;
}

function headersOf(ctx: unknown): Headers | undefined {
  const field = (value: unknown, key: string): unknown =>
    typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
  const headers = field(ctx, "headers") ?? field(field(ctx, "request"), "headers");
  return headers instanceof Headers ? headers : undefined;
}

/** What {@link adminEndpointLock} reads the client address with. */
export interface AdminEndpointLockOptions {
  /** `EDULIMS_TRUSTED_PROXIES`: without one, every anonymous caller is one client. */
  trustedProxies: readonly string[];
  /** Remembers the anonymous clients logged in the current minute; one per plugin by default. */
  deduper?: RefusalDeduper;
}

/**
 * Returns the plugin that refuses {@link CLOSED_AUTH_PATHS} with 404, over HTTP and on
 * `auth.api`, and records each call as a refused `authz_endpoint_closed` row (ASVS V16.3.2). A
 * signed-in caller's row carries their id and the user the call named; an anonymous caller's row
 * carries no target and is written once per client per minute, with the calls it stands for in
 * `refused_count`, so anonymous calls cannot fill the log (second review of #356, S4).
 */
export function adminEndpointLock(options: AdminEndpointLockOptions) {
  const deduper = options.deduper ?? new RefusalDeduper(60_000);
  return {
    id: "edulims-admin-endpoint-lock",
    hooks: {
      before: [
        {
          matcher: (ctx) => isClosed(ctx.path),
          handler: createAuthMiddleware(async (ctx) => {
            const session = await getSessionFromCtx(ctx);
            const requestId = requestIdOf(ctx);
            const recorder = auditRecorderOf(ctx.context);
            const common = {
              action: "authz_endpoint_closed",
              outcome: "refused",
              reason: ENDPOINT_CLOSED,
              ...(requestId ? { requestId } : {}),
            } as const;
            if (session) {
              const target = userIdOf(ctx.body);
              await recorder?.record({
                ...common,
                actor: { type: "user", id: session.user.id },
                ...(target ? { target: { type: "user", id: target } } : {}),
              });
            } else {
              const headers = headersOf(ctx);
              const ip = headers ? clientIpOf(headers, options.trustedProxies) : null;
              const count = deduper.next(`ip:${ip ?? "unknown"}`);
              if (count !== null) {
                await recorder?.record({
                  ...common,
                  actor: { type: "anonymous" },
                  metadata: { refused_count: count },
                });
              }
            }
            throw new APIError("NOT_FOUND", { code: "not_found", message: "Not Found" });
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
