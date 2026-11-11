// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Feeds the activity log (B4) from better-auth's extension points: database hooks for sessions
// and users, and an after hook for sign-in failures and the admin endpoints. better-auth commits
// these writes itself, so the log rows follow through recordCommittedAudit. The refusals raised
// in idp-sync.ts and role-guard.ts reach the recorder through auditRecorderOf.
// Relative imports: `pnpm db:seed` loads auth.ts in plain Node.
import "@tanstack/react-start/server-only";
import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware, isAPIError } from "better-auth/api";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import {
  NO_ROLE_ERROR,
  normalizeSignInError,
  PROVIDER_DISABLED_ERROR,
  ROLE_CONFLICT_ERROR,
} from "../../lib/identity-providers.ts";
import { formatRoles, validateRoleValue } from "../../lib/roles.ts";
import { getDb } from "../db/index.ts";
import type { DB } from "../db/schema.gen.ts";
import {
  type AuditActor,
  type AuditEvent,
  type AuditMetadata,
  type AuditProvider,
  auditProvider,
  toReasonCode,
  toRequestId,
} from "./events.ts";
import { recordCommittedAudit } from "./record.ts";

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** Records activity-log events for better-auth; one per auth instance. */
export class AuditRecorder {
  readonly #db: Kysely<DB>;

  constructor(db: Kysely<DB>) {
    this.#db = db;
  }

  /** Writes `event` after the fact; a failed write goes to the error log ({@link recordCommittedAudit}). */
  async record(event: AuditEvent): Promise<void> {
    await recordCommittedAudit(this.#db, event);
  }
}

const RECORDER_KEY = "edulimsAudit";

/** Returns the recorder the {@link auditLog} plugin put on a better-auth context, if any. */
export function auditRecorderOf(authContext: unknown): AuditRecorder | undefined {
  const recorder = field(authContext, RECORDER_KEY);
  return recorder instanceof AuditRecorder ? recorder : undefined;
}

/** Returns the request id the reverse proxy set (`X-Request-Id`), when it has a safe shape. */
export function requestIdOf(ctx: unknown): string | undefined {
  const headers = field(ctx, "headers") ?? field(field(ctx, "request"), "headers");
  return headers instanceof Headers ? toRequestId(headers.get("x-request-id")) : undefined;
}

/** Returns the id of the signed-in user on a better-auth endpoint context. */
export function sessionUserIdOf(ctx: unknown): string | undefined {
  return text(field(field(field(field(ctx, "context"), "session"), "user"), "id"));
}

/** The sso plugin's OIDC callback and SAML ACS (better-auth 1.7.20), where SSO sign-ins land. */
const OAUTH_CALLBACKS: ReadonlySet<string> = new Set([
  "/sso/callback/:providerId",
  "/sso/saml2/sp/acs/:providerId",
]);

/** Returns how the request signs in: an SSO callback's provider, or the development login. */
export function providerOf(ctx: unknown): AuditProvider | undefined {
  const path = field(ctx, "path");
  if (path === "/sign-in/email") return "credential";
  if (typeof path !== "string" || !OAUTH_CALLBACKS.has(path)) return undefined;
  const params = field(ctx, "params");
  return auditProvider(field(params, "providerId"));
}

function actorOf(ctx: unknown): AuditActor {
  const id = sessionUserIdOf(ctx);
  return id ? { type: "user", id } : { type: "system" };
}

function common(ctx: unknown): Pick<AuditEvent, "provider" | "requestId"> {
  const provider = providerOf(ctx);
  const requestId = requestIdOf(ctx);
  return { ...(provider ? { provider } : {}), ...(requestId ? { requestId } : {}) };
}

function rolesMetadata(role: unknown): AuditMetadata {
  const result = validateRoleValue(role);
  return result.ok ? { roles: formatRoles(result.roles) } : {};
}

/** The admin plugin endpoints whose outcome the after hook records (better-auth 1.7.18). */
const ADMIN_ACTIONS = {
  "/admin/ban-user": "user_banned",
  "/admin/unban-user": "user_unbanned",
  "/admin/set-role": "authz_role_change",
  "/admin/update-user": "authz_role_change",
  "/admin/remove-user": "user_deleted",
  "/admin/create-user": "user_created",
} as const satisfies Record<string, AuditEvent["action"]>;

type AdminPath = keyof typeof ADMIN_ACTIONS;

function isAdminPath(path: unknown): path is AdminPath {
  return typeof path === "string" && Object.hasOwn(ADMIN_ACTIONS, path);
}

/** Sign-in refusals idp-sync.ts records itself, with the user id the callback does not carry. */
const RECORDED_BY_IDP_SYNC: ReadonlySet<string> = new Set([
  NO_ROLE_ERROR,
  ROLE_CONFLICT_ERROR,
  PROVIDER_DISABLED_ERROR,
  "idp_test_complete",
]);

function oauthError(returned: unknown): string | undefined {
  if (!isAPIError(returned)) return undefined;
  const location = returned.headers instanceof Headers ? returned.headers.get("location") : null;
  if (!location) return "oauth_callback_failed";
  try {
    const error = text(new URL(location, "http://callback.invalid").searchParams.get("error"));
    return error ? normalizeSignInError(error) : undefined;
  } catch {
    return "oauth_callback_failed";
  }
}

async function userIdByEmail(ctx: unknown, email: unknown): Promise<string | undefined> {
  const adapter = field(field(ctx, "context"), "internalAdapter");
  const find = field(adapter, "findUserByEmail");
  if (typeof email !== "string" || typeof find !== "function") return undefined;
  const found: unknown = await Reflect.apply(find, adapter, [email.toLowerCase()]);
  return text(field(field(found, "user"), "id"));
}

/** The after hook: failed sign-ins and the outcome of every audited admin endpoint. */
async function afterEndpoint(recorder: AuditRecorder, ctx: unknown): Promise<void> {
  const path = field(ctx, "path");
  const returned = field(field(ctx, "context"), "returned");
  if (path === "/sign-in/email") {
    if (!isAPIError(returned)) return;
    const userId = await userIdByEmail(ctx, field(field(ctx, "body"), "email"));
    const reason = toReasonCode(field(returned.body, "code"));
    await recorder.record({
      action: "authn_login_fail",
      actor: { type: "anonymous" },
      outcome: "failure",
      ...(userId ? { target: { type: "user", id: userId } } : {}),
      ...(reason ? { reason } : {}),
      ...common(ctx),
    });
    return;
  }
  if (typeof path === "string" && OAUTH_CALLBACKS.has(path)) {
    const error = oauthError(returned);
    const reason = toReasonCode(error);
    if (!error || (reason && RECORDED_BY_IDP_SYNC.has(reason))) return;
    await recorder.record({
      action: "authn_login_fail",
      actor: { type: "anonymous" },
      outcome: "failure",
      ...(reason ? { reason } : {}),
      ...common(ctx),
    });
    return;
  }
  if (!isAdminPath(path)) return;
  await afterAdminEndpoint(recorder, ctx, path, returned);
}

async function afterAdminEndpoint(
  recorder: AuditRecorder,
  ctx: unknown,
  path: AdminPath,
  returned: unknown,
): Promise<void> {
  const body = field(ctx, "body");
  const data = field(body, "data");
  if (
    path === "/admin/update-user" &&
    !(typeof data === "object" && data !== null && "role" in data)
  )
    return;
  const action = ADMIN_ACTIONS[path];
  const targetId = text(field(body, "userId"));
  const target = targetId ? { target: { type: "user" as const, id: targetId } } : {};
  const base = { actor: actorOf(ctx), ...common(ctx), ...target };
  if (isAPIError(returned)) {
    const reason = toReasonCode(field(returned.body, "code"));
    const refused = returned.statusCode === 401 || returned.statusCode === 403;
    await recorder.record({
      action,
      outcome: refused ? "refused" : "failure",
      ...(reason ? { reason } : {}),
      ...base,
    });
    return;
  }
  // Successful creations and deletions are recorded by the user database hooks.
  if (action === "user_created" || action === "user_deleted") return;
  const user = field(returned, "user");
  const metadata: AuditMetadata =
    action === "authz_role_change"
      ? rolesMetadata(field(user, "role"))
      : action === "user_banned"
        ? banMetadata(field(user, "banExpires"))
        : {};
  await recorder.record({
    action,
    outcome: "success",
    ...base,
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  });
}

function banMetadata(banExpires: unknown): AuditMetadata {
  const date = banExpires instanceof Date ? banExpires : text(banExpires);
  if (date === undefined) return {};
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? {} : { ban_expires_at: parsed.toISOString() };
}

/** Why the admin endpoint at `path` ends sessions, as the reason of each `session_revoked`. */
function revokeReason(path: unknown): string | undefined {
  if (path === "/admin/ban-user") return "user_banned";
  if (path === "/admin/remove-user") return "user_deleted";
  if (typeof path === "string" && OAUTH_CALLBACKS.has(path)) return "sign_in_refused";
  return undefined;
}

type DatabaseHooks = NonNullable<BetterAuthOptions["databaseHooks"]>;

function databaseHooks(recorder: AuditRecorder): DatabaseHooks {
  return {
    session: {
      create: {
        after: async (session, ctx) => {
          await recorder.record({
            action: "authn_login_success",
            actor: { type: "user", id: session.userId },
            outcome: "success",
            target: { type: "user", id: session.userId },
            ...common(ctx),
          });
        },
      },
      delete: {
        after: async (session, ctx) => {
          const path = field(ctx, "path");
          if (path === "/sign-out") {
            await recorder.record({
              action: "authn_logout",
              actor: { type: "user", id: session.userId },
              outcome: "success",
              target: { type: "user", id: session.userId },
              ...common(ctx),
            });
            return;
          }
          const expired = session.expiresAt.getTime() <= Date.now();
          const reason = revokeReason(path);
          await recorder.record({
            action: expired && !reason ? "session_expired" : "session_revoked",
            actor: expired && !reason ? { type: "system" } : actorOf(ctx),
            outcome: "success",
            target: { type: "session", id: session.id },
            ...(reason ? { reason } : {}),
            ...common(ctx),
          });
        },
      },
    },
    user: {
      create: {
        after: async (user, ctx) => {
          const metadata = rolesMetadata(user["role"]);
          await recorder.record({
            action: "user_created",
            actor: actorOf(ctx),
            outcome: "success",
            target: { type: "user", id: user.id },
            ...common(ctx),
            ...(metadata.roles ? { metadata } : {}),
          });
        },
      },
      delete: {
        after: async (user, ctx) => {
          await recorder.record({
            action: "user_deleted",
            actor: actorOf(ctx),
            outcome: "success",
            target: { type: "user", id: user.id },
            ...common(ctx),
          });
        },
      },
    },
  };
}

/**
 * Returns the better-auth plugin that writes the activity log (B4) to `db`. It also puts its
 * recorder on the auth context, where {@link auditRecorderOf} finds it.
 */
export function auditLog(db: Kysely<DB>) {
  const recorder = new AuditRecorder(db);
  return {
    id: "edulims-audit-log",
    init: () => ({
      context: { [RECORDER_KEY]: recorder },
      options: { databaseHooks: databaseHooks(recorder) },
    }),
    hooks: {
      after: [
        {
          matcher: () => true,
          handler: createAuthMiddleware(async (ctx) => {
            await afterEndpoint(recorder, ctx);
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}

const pools = new WeakMap<Pool, Kysely<DB>>();

/**
 * Returns the Kysely instance the activity log writes through for better-auth's `database`
 * option: the Kysely instance a test passes, or one over the shared pool.
 */
export function auditDatabase(database: BetterAuthOptions["database"]): Kysely<DB> {
  const db = field(database, "db");
  if (db instanceof Kysely) return db;
  if (database instanceof Pool) {
    const existing = pools.get(database);
    if (existing) return existing;
    const created = new Kysely<DB>({ dialect: new PostgresDialect({ pool: database }) });
    pools.set(database, created);
    return created;
  }
  return getDb();
}
