// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The actions of the user detail sheet (#34, B1): block and unblock, end one or all sessions,
// and edit a local role set. Unblocking and sessions go through better-auth's admin endpoints
// with the administrator's own session, so its permission check and the activity-log hooks run;
// a block and the local role edit write in one transaction with their activity-log rows, under
// the administrator locks (B4, #345).
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
import { type AuditEvent, toRequestId } from "../audit/events.ts";
import { recordAudit, recordCommittedAudit } from "../audit/record.ts";
import type { Auth } from "../auth.ts";
import { hasRole, type SessionUser } from "../authz.ts";
import type { DB } from "../db/schema.gen.ts";
import { AuthError } from "../middleware.ts";
import { logSecurityEvent } from "../security-log.ts";
import {
  actorIsAdministrator,
  holdsAdmin,
  isLastAdministrator,
  LAST_ADMIN,
  lockForRoleChange,
  NOT_AN_ADMIN,
} from "./administrators.ts";
import { revokeSessionsForRoleChange } from "./revoke-sessions.ts";

/** Why an action was refused or failed; the sheet maps each code to a translated message. */
export const ADMIN_ACTION_ERRORS = [
  "not_found",
  "session_not_found",
  "cannot_block_self",
  "cannot_end_current_session",
  OWN_ROLES_ERROR,
  "roles_not_local",
  "role_set_not_allowed",
  LAST_ADMIN,
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

/** The outcome of a write under the administrator locks: an action result, or a lost admin role. */
type LockedOutcome = AdminActionResult | { ok: false; error: typeof NOT_AN_ADMIN };

const ACTOR_NOT_ADMIN: LockedOutcome = { ok: false, error: NOT_AN_ADMIN };

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
  logSecurityEvent("error", "admin_action_failed", {
    outcome: "failure",
    reason: typeof code === "string" ? code.toLowerCase() : undefined,
    status: error.statusCode,
  });
  return refused("failed");
}

async function userExists(db: Kysely<DB>, userId: string): Promise<boolean> {
  const row = await db.selectFrom("user").select("id").where("id", "=", userId).executeTakeFirst();
  return row !== undefined;
}

type Refusal =
  | { action: "user_banned" | "authz_role_change"; target: { type: "user"; id: string } }
  | { action: "session_revoked"; target: { type: "session"; id: string } };

/** Returns the request id of the administrator's request, as `requestId` fields to spread. */
function requestOf(ctx: ActionContext): { requestId?: string } {
  const requestId = toRequestId(ctx.headers.get("x-request-id"));
  return requestId ? { requestId } : {};
}

/** Records a refused action of the administrator in the activity log (A09, B4). */
function refusal(ctx: ActionContext, event: Refusal, reason: string): Promise<void> {
  const actor = { type: "user", id: ctx.actor.id } as const;
  const common = { actor, outcome: "refused", reason, ...requestOf(ctx) } as const;
  const logged: AuditEvent = { ...event, ...common };
  return recordCommittedAudit(ctx.db, logged);
}

/**
 * Ends a write under the administrator locks: logs a refusal whose code is in `logged`, and
 * refuses an actor who lost the admin role meanwhile with 403, logged as `not_an_admin` (#345).
 *
 * @throws AuthError 403 when the actor no longer holds the admin role.
 */
async function settle(
  ctx: ActionContext,
  event: Extract<Refusal, { action: "user_banned" | "authz_role_change" }>,
  outcome: LockedOutcome,
  logged: readonly AdminActionError[],
): Promise<AdminActionResult> {
  if (outcome.ok) return outcome;
  if (outcome.error === NOT_AN_ADMIN) {
    await refusal(ctx, event, NOT_AN_ADMIN);
    throw new AuthError(403);
  }
  if (logged.includes(outcome.error)) await refusal(ctx, event, outcome.error);
  return { ok: false, error: outcome.error };
}

/**
 * Blocks a user (owner decision on #32) with the reason and, when given, an end at the close of
 * the `until` day, and ends the user's sessions; every later sign-in, SSO included, is refused.
 * An administrator cannot block themselves, nor the last administrator who is not blocked
 * (`last_admin`, #345). The block, the ended sessions and their activity-log rows commit
 * together under the administrator locks.
 *
 * @throws AuthError 403 when the actor no longer holds the admin role.
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
  const target = { type: "user" as const, id: input.userId };
  const banExpires = input.until ? endOfDayIn(input.until) : null;
  const actor = { type: "user", id: ctx.actor.id } as const;
  // NOTE: #356 review (S3); the block is written here, not through better-auth's ban-user, so
  // the last-administrator rule and the ban share one transaction and its locks.
  const outcome = await ctx.db.transaction().execute(async (trx): Promise<LockedOutcome> => {
    const locks = await lockForRoleChange(trx, input.userId);
    if (!actorIsAdministrator(locks, ctx.actor.id, ctx.now)) return ACTOR_NOT_ADMIN;
    if (!locks.user) return refused("not_found");
    if (holdsAdmin(locks.user.role) && (await isLastAdministrator(trx, input.userId, ctx.now))) {
      return refused(LAST_ADMIN);
    }
    await trx
      .updateTable("user")
      .set({ banned: true, banReason: input.reason.trim(), banExpires, updatedAt: ctx.now })
      .where("id", "=", input.userId)
      .execute();
    const sessions = await trx
      .deleteFrom("session")
      .where("userId", "=", input.userId)
      .returning("id")
      .execute();
    for (const session of sessions.toSorted((a, b) => a.id.localeCompare(b.id))) {
      await recordAudit(trx, {
        action: "session_revoked",
        actor,
        outcome: "success",
        target: { type: "session", id: session.id },
        reason: "user_banned",
        ...requestOf(ctx),
      });
    }
    await recordAudit(trx, {
      action: "user_banned",
      actor,
      outcome: "success",
      target,
      ...requestOf(ctx),
      ...(banExpires ? { metadata: { ban_expires_at: banExpires.toISOString() } } : {}),
    });
    return DONE;
  });
  return settle(ctx, { action: "user_banned", target }, outcome, [LAST_ADMIN]);
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
 * owns, and never one that takes the admin role from the last administrator who is not blocked
 * (`last_admin`). The update and its `authz_role_change` row commit together; when a role goes,
 * the user's sessions end in the same transaction, each with a `session_revoked` row
 * (`roles_changed`).
 *
 * @throws AuthError 403 when the actor no longer holds the admin role.
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
  const outcome = await ctx.db.transaction().execute(async (trx): Promise<LockedOutcome> => {
    // NOTE: #345; the administrators are locked in id order before the target, as deleteUser
    // does, so two administrators who take the role from each other cannot both pass.
    const locks = await lockForRoleChange(trx, input.userId);
    if (!actorIsAdministrator(locks, ctx.actor.id, ctx.now)) return ACTOR_NOT_ADMIN;
    const { user } = locks;
    if (!user) return refused("not_found");
    if (!isLocallyEditable(parseRoleSource(user.role_source))) return refused("roles_not_local");
    if (user.role === role) return DONE;
    if (
      holdsAdmin(user.role) &&
      !holdsAdmin(role) &&
      (await isLastAdministrator(trx, input.userId, ctx.now))
    ) {
      return refused(LAST_ADMIN);
    }
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
      ...requestOf(ctx),
      metadata: {
        roles: role,
        ...(previous.ok ? { previous_roles: formatRoles(previous.roles) } : {}),
      },
    });
    // NOTE: maintainer decision on #345; a removed role ends the live sessions, as `admin revoke`
    // does, so the next request signs in with the new set.
    if (previous.ok && previous.roles.some((held) => !validated.roles.includes(held))) {
      await revokeSessionsForRoleChange(
        trx,
        input.userId,
        { type: "user", id: ctx.actor.id },
        requestOf(ctx).requestId,
      );
    }
    return DONE;
  });
  return settle(ctx, { action: "authz_role_change", target }, outcome, [
    "roles_not_local",
    LAST_ADMIN,
  ]);
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
