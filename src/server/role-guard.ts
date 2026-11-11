// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The last gate before a role set reaches the database: every user insert and update that
// carries a role (IdP sync, the seed, the admin plugin's create-user, set-role and update-user)
// runs through better-auth's database hooks. Relative imports: `pnpm db:seed` loads this in Node.
import "@tanstack/react-start/server-only";
import { APIError, type BetterAuthOptions } from "better-auth";
import { createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { ROLE_CONFLICT_ERROR } from "../lib/identity-providers.ts";
import { formatRoles, OWN_ROLES_ERROR, validateRoleValue } from "../lib/roles.ts";
import { auditRecorderOf, requestIdOf } from "./audit/better-auth-hooks.ts";
import { logSecurityEvent } from "./security-log.ts";

type UserHooks = NonNullable<NonNullable<BetterAuthOptions["databaseHooks"]>["user"]>;

/** The error better-auth returns when a write carries a role set that is not allowed. */
export const ROLE_SET_REFUSED = { code: "ROLE_SET_NOT_ALLOWED", message: ROLE_CONFLICT_ERROR };

/**
 * Returns the stored form of `value` (sorted, comma-separated) when it is an allowed role set
 * (ADR 0012).
 *
 * @throws APIError 400 `ROLE_SET_NOT_ALLOWED` for an unknown role, an empty set, or student
 * combined with teacher or admin.
 */
export function guardRoleValue(value: unknown): string {
  const result = validateRoleValue(value);
  if (!result.ok) {
    // Logs the reason only: never the user or the requested value (A09, privacy).
    logSecurityEvent("warn", "authz_role_write_refused", {
      outcome: "refused",
      reason: result.reason,
    });
    throw APIError.from("BAD_REQUEST", ROLE_SET_REFUSED);
  }
  return formatRoles(result.roles);
}

/** better-auth `databaseHooks.user` that validate and normalise every role write. */
export const roleWriteHooks = {
  create: {
    before: async (user) => {
      if (user["role"] === undefined) return;
      return { data: { ...user, role: guardRoleValue(user["role"]) } };
    },
  },
  update: {
    before: async (user) => {
      if (!Object.hasOwn(user, "role")) return;
      return { data: { ...user, role: guardRoleValue(user["role"]) } };
    },
  },
} satisfies UserHooks;

/** The error better-auth returns when an administrator writes their own roles. */
export const OWN_ROLES_REFUSED = { code: "CANNOT_CHANGE_OWN_ROLES", message: OWN_ROLES_ERROR };

/** The admin plugin endpoints that write a user's role (better-auth 1.7.18). */
const ROLE_WRITE_PATHS: ReadonlySet<string> = new Set(["/admin/set-role", "/admin/update-user"]);

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

/**
 * Returns whether a request to `path` with `body` writes the roles of the signed-in user
 * `sessionUserId`: `set-role`, or `update-user` with `data.role`, on their own user id.
 *
 * NOTE: A01 and the owner decision on #32; nobody changes their own roles, so an administrator
 * cannot give their own account teacher access.
 */
export function isOwnRoleWrite(
  path: string,
  body: unknown,
  sessionUserId: string | undefined,
): boolean {
  if (!sessionUserId || !ROLE_WRITE_PATHS.has(path)) return false;
  const userId = field(body, "userId");
  if (userId === undefined || userId === null || String(userId) !== sessionUserId) return false;
  if (path === "/admin/set-role") return true;
  const data = field(body, "data");
  return typeof data === "object" && data !== null && Object.hasOwn(data, "role");
}

/**
 * better-auth `hooks.before` middleware that refuses, with 403 `CANNOT_CHANGE_OWN_ROLES`, a
 * request that would change the signed-in user's own roles ({@link isOwnRoleWrite}).
 */
export const refuseOwnRoleWrites = createAuthMiddleware(async (ctx) => {
  if (!ROLE_WRITE_PATHS.has(ctx.path)) return;
  const session = await getSessionFromCtx(ctx);
  const userId = session?.user.id;
  if (userId && isOwnRoleWrite(ctx.path, ctx.body, userId)) {
    // The activity-log row also goes to the security log on stdout (recordAudit).
    const requestId = requestIdOf(ctx);
    await auditRecorderOf(ctx.context)?.record({
      action: "authz_role_change",
      actor: { type: "user", id: userId },
      outcome: "refused",
      reason: OWN_ROLES_ERROR,
      target: { type: "user", id: userId },
      ...(requestId ? { requestId } : {}),
    });
    throw APIError.from("FORBIDDEN", OWN_ROLES_REFUSED);
  }
});
