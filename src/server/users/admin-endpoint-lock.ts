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

/**
 * Returns the plugin that refuses {@link CLOSED_AUTH_PATHS} with 404, over HTTP and on
 * `auth.api`, and records each call as a refused `authz_endpoint_closed` row with the caller's
 * id when there is a session (ASVS V16.3.2).
 */
export function adminEndpointLock() {
  return {
    id: "edulims-admin-endpoint-lock",
    hooks: {
      before: [
        {
          matcher: (ctx) => isClosed(ctx.path),
          handler: createAuthMiddleware(async (ctx) => {
            const session = await getSessionFromCtx(ctx);
            const target = userIdOf(ctx.body);
            const requestId = requestIdOf(ctx);
            await auditRecorderOf(ctx.context)?.record({
              action: "authz_endpoint_closed",
              actor: session ? { type: "user", id: session.user.id } : { type: "anonymous" },
              outcome: "refused",
              reason: ENDPOINT_CLOSED,
              ...(target ? { target: { type: "user", id: target } } : {}),
              ...(requestId ? { requestId } : {}),
            });
            throw new APIError("NOT_FOUND", { code: "not_found", message: "Not Found" });
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
