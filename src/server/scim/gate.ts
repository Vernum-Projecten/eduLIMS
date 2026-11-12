// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The guard in front of `/api/auth/scim/v2` (#45, ADR 0017), on whether or not the scim plugin
// runs: 501 when this deployment cannot run it (support.ts), the rate limit and body cap
// (limits.ts; API4, ASVS V2.4.1), one owner per e-mail address (emails.ts; V6.8.1), and the
// activity log of every request (audit.ts; B4, V16.3.1). It also refuses a session for a user
// the directory deprovisioned. Relative imports: `pnpm db:seed` loads auth.ts in plain Node.
import "@tanstack/react-start/server-only";
import type { AuthContext, BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import type { Kysely } from "kysely";
import { ACCOUNT_DEPROVISIONED_ERROR } from "../../lib/identity-providers.ts";
import { requestIdOf } from "../audit/better-auth-hooks.ts";
import { auditProvider } from "../audit/events.ts";
import { recordCommittedAudit } from "../audit/record.ts";
import { clientIpOf } from "../client-ip.ts";
import type { DB } from "../db/schema.gen.ts";
import {
  auditScimRequest,
  RefusalDeduper,
  scimResourceAction,
  scimResourceEvent,
} from "./audit.ts";
import { addressOutsideDomains, addressTakenElsewhere, scimBodyAddresses } from "./emails.ts";
import {
  bearerOf,
  bodyTooLarge,
  rateKeyOf,
  SCIM_LIMITS,
  type ScimLimits,
  ScimRateLimiter,
} from "./limits.ts";
import { withDirectoryId } from "./sign-in.ts";
import { hasAsyncContext, type ScimSupport } from "./support.ts";
import { inspectScimToken } from "./verify.ts";

export { SCIM_LIMITS, type ScimLimits, ScimRateLimiter } from "./limits.ts";

const SCIM_MEDIA_TYPE = "application/scim+json";
const SCIM_ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";

/** Returns a SCIM error response (RFC 7644 §3.12) with only a status, a fixed detail and type. */
export function scimErrorResponse(
  status: number,
  detail: string,
  headers: Record<string, string> = {},
  scimType?: string,
): Response {
  return new Response(
    JSON.stringify({
      schemas: [SCIM_ERROR_SCHEMA],
      status: String(status),
      ...(scimType ? { scimType } : {}),
      detail,
    }),
    { status, headers: { "content-type": SCIM_MEDIA_TYPE, ...headers } },
  );
}

function isScimPath(path: string): boolean {
  return path.includes("/scim/v2/") || path.endsWith("/scim/v2");
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

const USER_WRITE_PATHS: ReadonlySet<string> = new Set(["/scim/v2/Users", "/scim/v2/Users/:userId"]);

/**
 * The before hook of H1: refuses a SCIM User create or change that would set an address outside
 * the provider's e-mail domains (when it has any), or take an address another sign-in method
 * owns, each with a generic refusal and a refused activity-log row. A request without a working
 * token passes on, so the plugin answers it with 401.
 */
async function refuseTakenAddress(db: Kysely<DB>, ctx: unknown): Promise<Response | undefined> {
  const path = field(ctx, "path");
  const method = field(field(ctx, "request"), "method") ?? field(ctx, "method");
  if (typeof path !== "string" || !USER_WRITE_PATHS.has(path) || typeof method !== "string") {
    return undefined;
  }
  if (!["POST", "PUT", "PATCH"].includes(method)) return undefined;
  const headers = field(ctx, "headers");
  const inspected = await inspectScimToken(
    db,
    headers instanceof Headers ? bearerOf(headers) : null,
  );
  if (!inspected.ok) return undefined;
  const addresses = scimBodyAddresses(field(ctx, "body"));
  const outside = await addressOutsideDomains(db, inspected.providerId, addresses);
  if (!outside && !(await addressTakenElsewhere(db, inspected.providerId, addresses))) {
    return undefined;
  }
  const action = scimResourceAction(method, "/scim/v2/Users");
  const provider = auditProvider(inspected.providerId);
  const requestId = requestIdOf(ctx);
  const userId = field(field(ctx, "params"), "userId");
  if (action) {
    await recordCommittedAudit(
      db,
      scimResourceEvent(
        action,
        {
          actor: { type: "system" },
          outcome: "refused",
          reason: outside ? "address_domain" : "uniqueness",
          ...(provider ? { provider } : {}),
          ...(requestId ? { requestId } : {}),
        },
        typeof userId === "string" ? userId : undefined,
      ),
    );
  }
  if (outside) return scimErrorResponse(400, "A value is not accepted", {}, "invalidValue");
  return scimErrorResponse(409, "A resource with these values already exists", {}, "uniqueness");
}

/** How the guard finds the client of a request. */
export interface ScimGateOptions {
  /**
   * The trusted proxies (`EDULIMS_TRUSTED_PROXIES`) whose `X-Forwarded-For` names the client.
   * Without any, every request lacking a working token shares one bucket, so a client cannot
   * spoof its way into a fresh one (second review, finding 2).
   */
  trustedProxies: readonly string[];
  limits?: ScimLimits;
  limiter?: ScimRateLimiter;
}

/**
 * Returns the eduLIMS SCIM guard plugin. `support` comes from the checks createAuth ran; the
 * async-context check runs here, on the first SCIM request.
 */
export function scimGate(db: Kysely<DB>, support: ScimSupport, options: ScimGateOptions) {
  const limits = options.limits ?? SCIM_LIMITS;
  const limiter = options.limiter ?? new ScimRateLimiter(limits);
  let asyncContext: Promise<boolean> | undefined;
  const clientKeyOf = (headers: Headers) =>
    rateKeyOf(null, clientIpOf(headers, options.trustedProxies));
  const deduper = new RefusalDeduper(limits.windowMs, limits.maxKeys);
  return {
    id: "edulims-scim-gate",
    init: (authContext: AuthContext) => {
      return {
        options: {
          databaseHooks: {
            account: {
              create: { before: async (account) => ({ data: await withDirectoryId(account) }) },
              update: { before: async (account) => ({ data: await withDirectoryId(account) }) },
            },
            user: {
              create: {
                // NOTE: owner decision on #32; a user the directory provisions has no roles
                // until its groups map one or an administrator assigns one, never a default.
                async before(user, ctx) {
                  if (!ctx?.path.startsWith("/scim/v2/")) return;
                  return { data: { ...user, role: null } };
                },
              },
            },
            session: {
              create: {
                // NOTE: #45; a user the directory deactivated or deleted gets no session by any
                // sign-in method, until the directory reactivates them.
                async before(session, ctx) {
                  const adapter = ctx?.context.internalAdapter ?? authContext.internalAdapter;
                  const user: unknown = await adapter.findUserById(session.userId);
                  if (field(user, "deprovisionedAt") instanceof Date) {
                    throw APIError.from("FORBIDDEN", {
                      code: ACCOUNT_DEPROVISIONED_ERROR,
                      message: "Account deactivated by the identity provider",
                    });
                  }
                },
              },
            },
          },
        },
      };
    },
    async onRequest(request: Request) {
      const path = new URL(request.url).pathname;
      if (!isScimPath(path)) return;
      if (!support.ok) return { response: scimErrorResponse(501, "SCIM is not available") };
      asyncContext ??= hasAsyncContext();
      if (!(await asyncContext)) {
        return { response: scimErrorResponse(501, "SCIM is not available") };
      }
      // NOTE: owner decision on #45 (V7.4.2); token first, so a provider on a shared egress IP
      // is never limited by others' bad tokens. The cost is one indexed digest lookup per request.
      const inspected = await inspectScimToken(db, bearerOf(request.headers));
      const key = inspected.ok
        ? rateKeyOf(inspected.providerId, null)
        : clientKeyOf(request.headers);
      const wait = limiter.hit(key);
      if (wait !== null) {
        return {
          response: scimErrorResponse(429, "Too many requests", { "retry-after": String(wait) }),
        };
      }
      if (await bodyTooLarge(request, limits.maxBodyBytes)) {
        return { response: scimErrorResponse(413, "Request body too large") };
      }
      return;
    },
    hooks: {
      before: [
        {
          matcher: (ctx: { path?: string }) => ctx.path?.startsWith("/scim/v2/Users") === true,
          handler: createAuthMiddleware(async (ctx) => refuseTakenAddress(db, ctx)),
        },
      ],
      after: [
        {
          matcher: (ctx: { path?: string }) => ctx.path?.startsWith("/scim/v2/") === true,
          handler: createAuthMiddleware(async (ctx) => {
            await auditScimRequest(db, ctx, deduper, clientKeyOf);
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
