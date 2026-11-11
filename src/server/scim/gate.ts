// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The guard in front of `/api/auth/scim/v2` (#45, ADR 0017), on whether or not the scim plugin
// runs: 501 when this deployment cannot run it (support.ts), a rate limit per bearer token and
// a size cap on request bodies (API4, ASVS V2.4.1), and an activity-log row for every SCIM
// write and refusal (B4, ASVS V16.3.1). It also refuses a session for a user the directory
// deprovisioned. Relative imports: `pnpm db:seed` loads auth.ts in plain Node.
import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import type { AuthContext, BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import type { Kysely } from "kysely";
import { ACCOUNT_DEPROVISIONED_ERROR } from "../../lib/identity-providers.ts";
import { requestIdOf } from "../audit/better-auth-hooks.ts";
import { type AuditEvent, auditProvider, toReasonCode } from "../audit/events.ts";
import { recordCommittedAudit } from "../audit/record.ts";
import type { DB } from "../db/schema.gen.ts";
import { hasAsyncContext, type ScimSupport } from "./support.ts";
import { providerOfScimToken } from "./tokens.ts";

const SCIM_MEDIA_TYPE = "application/scim+json";
const SCIM_ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";

/** The limits of the SCIM endpoint. */
export interface ScimLimits {
  /** Requests one bearer token (or all requests without one) may make per window. */
  maxRequests: number;
  windowMs: number;
  /** The largest request body accepted, in bytes. */
  maxBodyBytes: number;
}

// NOTE: no requirement governs this: our own design (#45). A directory sync of a few thousand
// users stays well inside it; the numbers are a question for the owner in the PR.
export const SCIM_LIMITS: ScimLimits = {
  maxRequests: 600,
  windowMs: 60_000,
  maxBodyBytes: 1_048_576,
};

/** Returns a SCIM error response (RFC 7644 §3.12) with only a status and a fixed detail. */
export function scimErrorResponse(
  status: number,
  detail: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(
    JSON.stringify({ schemas: [SCIM_ERROR_SCHEMA], status: String(status), detail }),
    { status, headers: { "content-type": SCIM_MEDIA_TYPE, ...headers } },
  );
}

/** A fixed-window counter per key, in this process's memory. */
export class ScimRateLimiter {
  readonly #limits: Pick<ScimLimits, "maxRequests" | "windowMs">;
  #windows = new Map<string, { start: number; count: number }>();

  constructor(limits: Pick<ScimLimits, "maxRequests" | "windowMs">) {
    this.#limits = limits;
  }

  /** Counts one request for `key`; returns the seconds to wait when it is over the limit. */
  hit(key: string, now: number = Date.now()): number | null {
    const window = this.#windows.get(key);
    if (!window || now - window.start >= this.#limits.windowMs) {
      if (this.#windows.size > 10_000) this.#prune(now);
      this.#windows.set(key, { start: now, count: 1 });
      return null;
    }
    window.count += 1;
    if (window.count <= this.#limits.maxRequests) return null;
    return Math.max(1, Math.ceil((window.start + this.#limits.windowMs - now) / 1000));
  }

  #prune(now: number): void {
    for (const [key, window] of this.#windows) {
      if (now - window.start >= this.#limits.windowMs) this.#windows.delete(key);
    }
  }
}

/** Returns the bearer token of a request, if it sends one. */
export function bearerOf(headers: Headers): string | null {
  const match = headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}

/** Returns the rate-limit key of a request: a digest of its token, never the token itself. */
export function rateKeyOf(headers: Headers): string {
  const token = bearerOf(headers);
  return token ? createHash("sha256").update(token).digest("hex") : "anonymous";
}

/** Returns whether a request body is larger than `max` bytes, reading at most `max + 1`. */
export async function bodyTooLarge(request: Request, max: number): Promise<boolean> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return true;
  if (!request.body) return false;
  const reader = request.clone().body?.getReader();
  if (!reader) return false;
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return false;
    size += value.byteLength;
    if (size > max) {
      // NOTE: no requirement governs this: our own design; cancelling a tee'd clone waits for
      // the other branch, so the clone is released and dropped instead.
      reader.releaseLock();
      return true;
    }
  }
}

function isScimPath(path: string): boolean {
  return path.includes("/scim/v2/") || path.endsWith("/scim/v2");
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

const USER_WRITES = ["scim_user_created", "scim_user_updated", "scim_user_deleted"] as const;
const GROUP_WRITES = ["scim_group_created", "scim_group_updated", "scim_group_deleted"] as const;
type UserWrite = (typeof USER_WRITES)[number];
type GroupWrite = (typeof GROUP_WRITES)[number];
type ScimWrite = UserWrite | GroupWrite;

function isUserWrite(action: ScimWrite): action is UserWrite {
  return (USER_WRITES as readonly string[]).includes(action);
}

/** Returns the activity-log action of a SCIM request, or `null` for a read. */
export function scimWriteAction(method: string, path: string): ScimWrite | null {
  const users = path.startsWith("/scim/v2/Users");
  if (!users && !path.startsWith("/scim/v2/Groups")) return null;
  const writes: readonly ScimWrite[] = users ? USER_WRITES : GROUP_WRITES;
  if (method === "POST") return writes[0] ?? null;
  if (method === "PUT" || method === "PATCH") return writes[1] ?? null;
  if (method === "DELETE") return writes[2] ?? null;
  return null;
}

function statusOf(returned: unknown): number | undefined {
  const status = field(returned, "statusCode");
  return typeof status === "number" ? status : undefined;
}

type EventBase = Pick<AuditEvent, "actor" | "outcome" | "provider" | "requestId" | "reason">;

/** Builds the event of one SCIM write, with the SCIM resource as its target when known. */
export function scimWriteEvent(
  action: ScimWrite,
  base: EventBase,
  resourceId: string | undefined,
): AuditEvent {
  if (isUserWrite(action)) {
    return {
      ...base,
      action,
      ...(resourceId ? { target: { type: "scim_user", id: resourceId } } : {}),
    };
  }
  return {
    ...base,
    action,
    ...(resourceId ? { target: { type: "scim_group", id: resourceId } } : {}),
  };
}

async function auditScimRequest(db: Kysely<DB>, ctx: unknown): Promise<void> {
  const path = text(field(ctx, "path")) ?? "";
  const request = field(ctx, "request");
  const method = text(field(ctx, "method")) ?? text(field(request, "method")) ?? "GET";
  const action = scimWriteAction(method, path);
  if (!action) return;
  const headers = field(ctx, "headers");
  const token = headers instanceof Headers ? bearerOf(headers) : null;
  const provider = auditProvider(token ? await providerOfScimToken(db, token) : undefined);
  const returned = field(field(ctx, "context"), "returned");
  const params = field(ctx, "params");
  const resourceId =
    text(field(params, "userId")) ?? text(field(params, "groupId")) ?? text(field(returned, "id"));
  const requestId = requestIdOf(ctx);
  const known = { ...(provider ? { provider } : {}), ...(requestId ? { requestId } : {}) };
  if (isAPIError(returned)) {
    const status = statusOf(returned) ?? 500;
    const reason = toReasonCode(field(returned.body, "scimType")) ?? toReasonCode(`http_${status}`);
    const base: EventBase = {
      actor: provider ? { type: "system" } : { type: "anonymous" },
      // A 404 is what a token gets for another provider's resource (A01), so it is a refusal.
      outcome: status === 401 || status === 403 || status === 404 ? "refused" : "failure",
      ...known,
      ...(reason ? { reason } : {}),
    };
    await recordCommittedAudit(db, scimWriteEvent(action, base, resourceId));
    return;
  }
  const base: EventBase = { actor: { type: "system" }, outcome: "success", ...known };
  await recordCommittedAudit(db, scimWriteEvent(action, base, resourceId));
}

/**
 * Returns the eduLIMS SCIM guard plugin. `support` comes from the checks createAuth ran; the
 * async-context check runs here, on the first SCIM request.
 */
export function scimGate(
  db: Kysely<DB>,
  support: ScimSupport,
  limits: ScimLimits = SCIM_LIMITS,
  limiter: ScimRateLimiter = new ScimRateLimiter(limits),
) {
  let asyncContext: Promise<boolean> | undefined;
  return {
    id: "edulims-scim-gate",
    init: (authContext: AuthContext) => ({
      options: {
        databaseHooks: {
          user: {
            create: {
              // NOTE: owner decision on #32; a user the directory provisions has no roles until
              // its groups map one or an administrator assigns one, never a default role.
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
    }),
    async onRequest(request: Request) {
      const path = new URL(request.url).pathname;
      if (!isScimPath(path)) return;
      if (!support.ok) return { response: scimErrorResponse(501, "SCIM is not available") };
      asyncContext ??= hasAsyncContext();
      if (!(await asyncContext)) {
        return { response: scimErrorResponse(501, "SCIM is not available") };
      }
      const wait = limiter.hit(rateKeyOf(request.headers));
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
      after: [
        {
          matcher: (ctx: { path?: string }) => ctx.path?.startsWith("/scim/v2/") === true,
          handler: createAuthMiddleware(async (ctx) => {
            await auditScimRequest(db, ctx);
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
