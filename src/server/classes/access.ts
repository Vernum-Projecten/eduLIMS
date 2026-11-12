// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The access rule of every class write (#28, D3, R-01): the app role teacher, then the class
// role from a membership query on the session user, then the class role's permission, then the
// archive state, all inside the transaction that writes, with the class row locked.
import "@tanstack/react-start/server-only";
import type { Kysely, Transaction } from "kysely";
import {
  type ClassPermission,
  type ClassRole,
  classCan,
  isClassRole,
  isTeachingRole,
} from "../../lib/classes.ts";
import type { Role } from "../../lib/roles.ts";
import type { AuditEvent } from "../audit/events.ts";
import { recordAudit } from "../audit/record.ts";
import { hasRole } from "../authz.ts";
import { UUID_PATTERN } from "../db/ids.ts";
import type { DB } from "../db/schema.gen.ts";
import { AuthError } from "../middleware.ts";
import { logSecurityEvent } from "../security-log.ts";

/** Why a class action was refused; the screens map each code to a translated message. */
export const CLASS_ACTION_ERRORS = [
  "not_found",
  "forbidden",
  "archived",
  "not_archived",
  "owner_not_removable",
  "not_class_teacher",
  "not_class_student",
  "has_work",
  "group_not_found",
  "group_name_taken",
  "group_set_exists",
  "group_set_empty",
  "invitation_not_found",
  "join_code_exists",
  "join_code_off",
  "invalid_code",
  "rate_limited",
  "not_a_student",
] as const;
export type ClassActionError = (typeof CLASS_ACTION_ERRORS)[number];

/** The outcome of a class action: done, with an optional value, or refused with a code. */
export type ClassResult<T = null> = { ok: true; value: T } | { ok: false; error: ClassActionError };

/** Returns a done result. */
export function done<T>(value: T): ClassResult<T> {
  return { ok: true, value };
}

/** Returns a refusal. */
export function refused<T>(error: ClassActionError): ClassResult<T> {
  return { ok: false, error };
}

/** Who acts: the session user, never an id from the request. */
export interface ClassActor {
  id: string;
  roles: readonly Role[];
}

/**
 * Refuses a caller without the app role teacher, whatever else they hold (ADR 0012). The
 * middleware checks first; this keeps each action safe on its own.
 *
 * @throws AuthError 403 without the app role teacher.
 */
export function assertTeacher(actor: Pick<ClassActor, "roles">): void {
  if (!hasRole(actor, "teacher")) throw new AuthError(403);
}

/**
 * Writes a class the actor does not teach (or no class at all) to the security stream as
 * `authz_fail` (ASVS V16.3.2): the actor's id and the class id asked for, nothing else. A
 * malformed id is written as `redacted`.
 */
export function logClassNotFound(actorId: string, classId: string): void {
  logSecurityEvent("warn", "authz_fail", {
    outcome: "refused",
    actor_type: "user",
    actor_id: actorId,
    target_type: "class",
    target_id: classId,
    reason: "not_class_teacher",
    status: 404,
  });
}

/** The locked class and the actor's role in it. */
export interface LockedClass {
  id: string;
  role: ClassRole;
  archived: boolean;
}

/**
 * Locks the class row (`FOR UPDATE`) and returns it with the actor's class role, or `null` when
 * the id is no class or the actor is no member of it. One query: the membership is the filter.
 */
export async function lockClass(
  trx: Kysely<DB>,
  classId: string,
  userId: string,
): Promise<LockedClass | null> {
  if (!UUID_PATTERN.test(classId)) return null;
  const row = await trx
    .selectFrom("organization")
    .innerJoin("member", "member.organizationId", "organization.id")
    .select(["organization.id", "organization.archived_at", "member.role"])
    .where("organization.id", "=", classId)
    .where("member.userId", "=", userId)
    .forUpdate("organization")
    .executeTakeFirst();
  if (!row || !isClassRole(row.role)) return null;
  return { id: row.id, role: row.role, archived: row.archived_at !== null };
}

/** How {@link withClass} records a refusal (A09): the action it refused. */
export type RefusalAction = Extract<
  AuditEvent["action"],
  `class_${string}` | "invitation_created" | "invitation_resent" | "invitation_revoked"
>;

async function recordRefusal(
  trx: Kysely<DB>,
  actor: ClassActor,
  action: RefusalAction,
  classId: string,
  reason: ClassActionError,
): Promise<void> {
  const base = { actor: { type: "user", id: actor.id }, outcome: "refused", reason } as const;
  switch (action) {
    case "invitation_created":
    case "invitation_resent":
    case "invitation_revoked":
      // An invitation refusal names no invitation: the class goes into the metadata.
      await recordAudit(trx, { ...base, action, metadata: { class_id: classId } });
      return;
    default:
      await recordAudit(trx, { ...base, action, target: { type: "class", id: classId } });
  }
}

/** What {@link withClass} checks before it runs the action. */
export interface ClassCheck {
  classId: string;
  permission: ClassPermission;
  /** The activity-log action a refusal is recorded under. */
  action: RefusalAction;
  /** Whether the action may run on an archived class (copying one does). */
  allowArchived?: boolean;
}

/**
 * Runs `action` in one transaction after the class checks: the app role teacher (403), a
 * teaching membership (`not_found` otherwise, so another teacher's class is not revealed), the
 * class role's permission (`forbidden`) and, unless allowed, an active class (`archived`).
 * Refusals by role or archive are recorded in the activity log.
 *
 * @throws AuthError 403 without the app role teacher.
 */
export async function withClass<T>(
  db: Kysely<DB>,
  actor: ClassActor,
  check: ClassCheck,
  action: (trx: Transaction<DB>, locked: LockedClass) => Promise<ClassResult<T>>,
): Promise<ClassResult<T>> {
  assertTeacher(actor);
  return db.transaction().execute(async (trx) => {
    const locked = await lockClass(trx, check.classId, actor.id);
    if (!locked || !isTeachingRole(locked.role)) {
      logClassNotFound(actor.id, check.classId);
      return refused<T>("not_found");
    }
    if (!classCan(locked.role, check.permission)) {
      await recordRefusal(trx, actor, check.action, locked.id, "forbidden");
      return refused<T>("forbidden");
    }
    if (locked.archived && !check.allowArchived) {
      await recordRefusal(trx, actor, check.action, locked.id, "archived");
      return refused<T>("archived");
    }
    return action(trx, locked);
  });
}
