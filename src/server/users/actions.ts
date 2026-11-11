// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The actions of the user detail sheet (#34, B1): block and unblock, end one or all sessions,
// and edit a local role set. Blocks and sessions go through better-auth's admin endpoints with
// the administrator's own session, so its permission check and the activity-log hooks run; the
// local role edit writes in one transaction with its activity-log row (B4).
import "@tanstack/react-start/server-only";
import { isAPIError } from "better-auth/api";
import type { Kysely } from "kysely";
import { endOfDayIn } from "../../lib/app-day.ts";
import { isLocallyEditable, parseRoleSource } from "../../lib/role-source.ts";
import {
  formatRoles,
  OWN_ROLES_ERROR,
  type Role,
  validateRoleSet,
  validateRoleValue,
} from "../../lib/roles.ts";
import type { AuditEvent } from "../audit/events.ts";
import { recordAudit, recordCommittedAudit } from "../audit/record.ts";
import type { Auth } from "../auth.ts";
import { hasRole, type SessionUser } from "../authz.ts";
import type { DB } from "../db/schema.gen.ts";
import { AuthError } from "../middleware.ts";

/** Why an action was refused or failed; the sheet maps each code to a translated message. */
export const ADMIN_ACTION_ERRORS = [
  "not_found",
  "session_not_found",
  "cannot_block_self",
  "cannot_end_current_session",
  OWN_ROLES_ERROR,
  "roles_not_local",
  "role_set_not_allowed",
  "failed",
] as const;
export type AdminActionError = (typeof ADMIN_ACTION_ERRORS)[number];

/** The outcome of an action: done, or refused with a code (never a thrown string). */
export type AdminActionResult = { ok: true } | { ok: false; error: AdminActionError };

/** What every action runs with: the auth instance, the database, the actor and their request. */
export interface ActionContext {
  auth: Auth;
  db: Kysely<DB>;
  actor: Pick<SessionUser, "id" | "roles">;
  /** The administrator's request headers, which carry their session cookie. */
  headers: Headers;
  now: Date;
}

const DONE: AdminActionResult = { ok: true };

function refused(error: AdminActionError): AdminActionResult {
  return { ok: false, error };
}

/**
 * Refuses a caller without the admin role, whatever else they hold (B1, ADR 0012). The
 * middleware checks first; this keeps each action safe on its own.
 *
 * @throws AuthError 403 without the admin role.
 */
export function assertAdmin(actor: Pick<SessionUser, "roles">): void {
  if (!hasRole(actor, "admin")) throw new AuthError(403);
}

/** Maps a better-auth error to an action error, logging the code only (A09, privacy). */
function fromAuthError(error: unknown): AdminActionResult {
  if (!isAPIError(error)) throw error;
  const code: unknown = Reflect.get(error.body ?? {}, "code");
  if (code === "USER_NOT_FOUND") return refused("not_found");
  if (code === "YOU_CANNOT_BAN_YOURSELF") return refused("cannot_block_self");
  console.error(`admin action failed: ${typeof code === "string" ? code : error.statusCode}`);
  return refused("failed");
}

async function userExists(db: Kysely<DB>, userId: string): Promise<boolean> {
  const row = await db.selectFrom("user").select("id").where("id", "=", userId).executeTakeFirst();
  return row !== undefined;
}

type Refusal =
  | { action: "user_banned" | "authz_role_change"; target: { type: "user"; id: string } }
  | { action: "session_revoked"; target: { type: "session"; id: string } };

/** Records a refused action of the administrator in the activity log (A09, B4). */
function refusal(ctx: ActionContext, event: Refusal, reason: string): Promise<void> {
  const actor = { type: "user", id: ctx.actor.id } as const;
  const logged: AuditEvent =
    event.action === "session_revoked"
      ? { action: event.action, target: event.target, actor, outcome: "refused", reason }
      : { action: event.action, target: event.target, actor, outcome: "refused", reason };
  return recordCommittedAudit(ctx.db, logged);
}

/**
 * Blocks a user (owner decision on #32): better-auth's `ban-user` with the reason and, when
 * given, an end at the close of the `until` day; it also ends the user's sessions, and every
 * later sign-in, SSO included, is refused. An administrator cannot block themselves.
 */
export async function blockUser(
  ctx: ActionContext,
  input: { userId: string; reason: string; until: string },
): Promise<AdminActionResult> {
  assertAdmin(ctx.actor);
  if (input.userId === ctx.actor.id) {
    await refusal(
      ctx,
      { action: "user_banned", target: { type: "user", id: input.userId } },
      "cannot_block_self",
    );
    return refused("cannot_block_self");
  }
  if (!(await userExists(ctx.db, input.userId))) return refused("not_found");
  const banExpiresIn = input.until
    ? Math.max(1, Math.round((endOfDayIn(input.until).getTime() - ctx.now.getTime()) / 1000))
    : undefined;
  try {
    await ctx.auth.api.banUser({
      body: {
        userId: input.userId,
        banReason: input.reason.trim(),
        ...(banExpiresIn ? { banExpiresIn } : {}),
      },
      headers: ctx.headers,
    });
    return DONE;
  } catch (error) {
    return fromAuthError(error);
  }
}

/** Lifts the block of a user through better-auth's `unban-user`. */
export async function unblockUser(
  ctx: ActionContext,
  input: { userId: string },
): Promise<AdminActionResult> {
  assertAdmin(ctx.actor);
  if (!(await userExists(ctx.db, input.userId))) return refused("not_found");
  try {
    await ctx.auth.api.unbanUser({ body: { userId: input.userId }, headers: ctx.headers });
    return DONE;
  } catch (error) {
    return fromAuthError(error);
  }
}

async function currentSessionId(ctx: ActionContext): Promise<string | null> {
  const session = await ctx.auth.api.getSession({ headers: ctx.headers });
  return session?.session.id ?? null;
}

async function revokeByToken(ctx: ActionContext, token: string): Promise<AdminActionResult> {
  try {
    await ctx.auth.api.revokeUserSession({ body: { sessionToken: token }, headers: ctx.headers });
    return DONE;
  } catch (error) {
    return fromAuthError(error);
  }
}

/**
 * Ends one session of a user. The session is named by its id; its token is looked up here, in
 * the same query that checks it belongs to `userId`. The administrator's own current session
 * is refused: signing out does that.
 */
export async function endSession(
  ctx: ActionContext,
  input: { userId: string; sessionId: string },
): Promise<AdminActionResult> {
  assertAdmin(ctx.actor);
  if (input.sessionId === (await currentSessionId(ctx))) {
    await refusal(
      ctx,
      { action: "session_revoked", target: { type: "session", id: input.sessionId } },
      "cannot_end_current_session",
    );
    return refused("cannot_end_current_session");
  }
  const row = await ctx.db
    .selectFrom("session")
    .select("token")
    .where("id", "=", input.sessionId)
    .where("userId", "=", input.userId)
    .executeTakeFirst();
  if (!row) return refused("session_not_found");
  return revokeByToken(ctx, row.token);
}

/**
 * Ends every session of a user. On the administrator's own account it ends every session but
 * the current one.
 */
export async function endAllSessions(
  ctx: ActionContext,
  input: { userId: string },
): Promise<AdminActionResult> {
  assertAdmin(ctx.actor);
  if (!(await userExists(ctx.db, input.userId))) return refused("not_found");
  if (input.userId !== ctx.actor.id) {
    try {
      await ctx.auth.api.revokeUserSessions({
        body: { userId: input.userId },
        headers: ctx.headers,
      });
      return DONE;
    } catch (error) {
      return fromAuthError(error);
    }
  }
  const current = await currentSessionId(ctx);
  const others = await ctx.db
    .selectFrom("session")
    .select("token")
    .where("userId", "=", input.userId)
    .$if(current !== null, (qb) => qb.where("id", "!=", current ?? ""))
    .execute();
  for (const session of others) {
    const result = await revokeByToken(ctx, session.token);
    if (!result.ok) return result;
  }
  return DONE;
}

/**
 * Sets the role set of a user whose roles are local (hybrid ownership, owner decision on #32):
 * an allowed set (ADR 0012), never the administrator's own, never a set the identity provider
 * owns. The update and its `authz_role_change` row commit together.
 */
export async function setLocalRoles(
  ctx: ActionContext,
  input: { userId: string; roles: readonly Role[] },
): Promise<AdminActionResult> {
  assertAdmin(ctx.actor);
  const target = { type: "user" as const, id: input.userId };
  if (input.userId === ctx.actor.id) {
    await refusal(ctx, { action: "authz_role_change", target }, OWN_ROLES_ERROR);
    return refused(OWN_ROLES_ERROR);
  }
  const validated = validateRoleSet(input.roles);
  if (!validated.ok) return refused("role_set_not_allowed");
  const role = formatRoles(validated.roles);
  const outcome = await ctx.db.transaction().execute(async (trx) => {
    const user = await trx
      .selectFrom("user")
      .select(["role", "role_source"])
      .where("id", "=", input.userId)
      .forUpdate()
      .executeTakeFirst();
    if (!user) return refused("not_found");
    if (!isLocallyEditable(parseRoleSource(user.role_source))) return refused("roles_not_local");
    if (user.role === role) return DONE;
    await trx
      .updateTable("user")
      .set({ role, updatedAt: ctx.now })
      .where("id", "=", input.userId)
      .where("role_source", "=", "local")
      .execute();
    const previous = validateRoleValue(user.role);
    await recordAudit(trx, {
      action: "authz_role_change",
      actor: { type: "user", id: ctx.actor.id },
      outcome: "success",
      target,
      metadata: {
        roles: role,
        ...(previous.ok ? { previous_roles: formatRoles(previous.roles) } : {}),
      },
    });
    return DONE;
  });
  if (!outcome.ok && outcome.error === "roles_not_local") {
    await refusal(ctx, { action: "authz_role_change", target }, "roles_not_local");
  }
  return outcome;
}

/** The outcome of a bulk action: the users it was done for, and each refusal with its code. */
export interface BulkActionResult {
  done: string[];
  refused: { userId: string; error: AdminActionError }[];
}

/**
 * Runs a single-user action for each of `userIds` in turn, so every user gets the same checks,
 * refusals and activity-log rows as one action on its own (B4). A refusal does not stop the rest.
 */
async function forEachUser(
  ctx: ActionContext,
  userIds: readonly string[],
  action: (userId: string) => Promise<AdminActionResult>,
): Promise<BulkActionResult> {
  assertAdmin(ctx.actor);
  const result: BulkActionResult = { done: [], refused: [] };
  for (const userId of new Set(userIds)) {
    const outcome = await action(userId);
    if (outcome.ok) result.done.push(userId);
    else result.refused.push({ userId, error: outcome.error });
  }
  return result;
}

/**
 * Ends every session of each selected user (#58), as {@link endAllSessions} does for one: on
 * the administrator's own account every session but the current one.
 */
export function bulkEndAllSessions(
  ctx: ActionContext,
  input: { userIds: readonly string[] },
): Promise<BulkActionResult> {
  return forEachUser(ctx, input.userIds, (userId) => endAllSessions(ctx, { userId }));
}

/**
 * Blocks each selected user with one reason and end date (#58), as {@link blockUser} does for
 * one: the administrator's own account is refused with `cannot_block_self` and logged.
 */
export function bulkBlockUsers(
  ctx: ActionContext,
  input: { userIds: readonly string[]; reason: string; until: string },
): Promise<BulkActionResult> {
  return forEachUser(ctx, input.userIds, (userId) =>
    blockUser(ctx, { userId, reason: input.reason, until: input.until }),
  );
}
