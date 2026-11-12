// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The administrator's class actions (#37, B2): transfer the ownership, archive and reopen,
// create a class on a teacher's behalf and import students from a CSV list. The administrator
// acts on any class without being a member of it, and none of these makes them one (R-01).
// Each write runs in one transaction that locks the class row and writes its activity-log row.
import "@tanstack/react-start/server-only";
import type { Kysely, Transaction } from "kysely";
import { validateRoleValue } from "../../lib/roles.ts";
import { recordAudit } from "../audit/record.ts";
import { hasRole } from "../authz.ts";
import { UUID_PATTERN } from "../db/ids.ts";
import type { DB } from "../db/schema.gen.ts";
import { AuthError } from "../middleware.ts";
import {
  type ClassActionError,
  type ClassActor,
  type ClassResult,
  done,
  type RefusalAction,
  refused,
} from "./access.ts";
import {
  addMember,
  type ClassFields,
  insertClass,
  refreshGroupCounts,
  userActor,
} from "./classes.ts";
import {
  classifyInvitees,
  type InviteOutcome,
  type InviteRow,
  writeInvitations,
} from "./invitations.ts";

/**
 * Refuses a caller without the app role admin, whatever else they hold (ADR 0012). The
 * middleware checks first; this keeps each action safe on its own.
 *
 * @throws AuthError 403 without the app role admin.
 */
export function assertAdmin(actor: Pick<ClassActor, "roles">): void {
  if (!hasRole(actor, "admin")) throw new AuthError(403);
}

/** Returns whether a stored app role value includes teacher (ADR 0012). */
export function isAppTeacher(stored: string | null | undefined): boolean {
  const parsed = validateRoleValue(stored);
  return parsed.ok && parsed.roles.includes("teacher");
}

/**
 * Returns why `userId` cannot own a class at `now`, or `null` when they can: the app role
 * teacher is required (`not_a_teacher`), and a blocked user is refused (`owner_blocked`, #37).
 */
async function ownerRefusal(
  trx: Kysely<DB>,
  userId: string,
  now: Date,
): Promise<"not_a_teacher" | "owner_blocked" | null> {
  const user = await trx
    .selectFrom("user")
    .select(["role", "banned", "banExpires"])
    .where("id", "=", userId)
    // A concurrent role change or block waits for this transaction (security review of #37).
    .forShare()
    .executeTakeFirst();
  if (!user || !isAppTeacher(user.role)) return "not_a_teacher";
  const blocked = user.banned === true && (user.banExpires === null || user.banExpires > now);
  return blocked ? "owner_blocked" : null;
}

/** A class the administrator locked: its id and archive state. */
interface AdminLockedClass {
  id: string;
  archived: boolean;
}

/** Locks any class row (`FOR UPDATE`) without a membership filter; `null` for no class. */
async function lockAnyClass(trx: Kysely<DB>, classId: string): Promise<AdminLockedClass | null> {
  if (!UUID_PATTERN.test(classId)) return null;
  const row = await trx
    .selectFrom("organization")
    .select(["id", "archived_at"])
    .where("id", "=", classId)
    .forUpdate()
    .executeTakeFirst();
  return row ? { id: row.id, archived: row.archived_at !== null } : null;
}

async function recordAdminRefusal(
  trx: Kysely<DB>,
  actor: ClassActor,
  action: RefusalAction,
  classId: string,
  reason: ClassActionError,
): Promise<void> {
  const base = { actor: userActor(actor), outcome: "refused", reason } as const;
  switch (action) {
    case "invitation_created":
    case "invitation_resent":
    case "invitation_revoked":
      await recordAudit(trx, { ...base, action, metadata: { class_id: classId } });
      return;
    default:
      await recordAudit(trx, { ...base, action, target: { type: "class", id: classId } });
  }
}

/** What {@link withAdminClass} checks before it runs the action. */
interface AdminClassCheck {
  classId: string;
  /** The activity-log action a refusal is recorded under. */
  action: RefusalAction;
  /** Whether the action may run on an archived class (reopening one does). */
  allowArchived?: boolean;
  /** Whether a refusal writes an activity-log row; a read-only preview records none. */
  record?: boolean;
}

/**
 * Runs `action` in one transaction after the administrator's checks: the app role admin (403),
 * an existing class (`not_found`) and, unless allowed, an active one (`archived`, recorded).
 *
 * @throws AuthError 403 without the app role admin.
 */
async function withAdminClass<T>(
  db: Kysely<DB>,
  actor: ClassActor,
  check: AdminClassCheck,
  action: (trx: Transaction<DB>, locked: AdminLockedClass) => Promise<ClassResult<T>>,
): Promise<ClassResult<T>> {
  assertAdmin(actor);
  return db.transaction().execute(async (trx) => {
    const locked = await lockAnyClass(trx, check.classId);
    if (!locked) return refused<T>("not_found");
    if (locked.archived && !check.allowArchived) {
      if (check.record !== false) {
        await recordAdminRefusal(trx, actor, check.action, locked.id, "archived");
      }
      return refused<T>("archived");
    }
    return action(trx, locked);
  });
}

/** Archives any class (#37): read-only and out of the default lists, its data kept. */
export function adminArchiveClass(
  db: Kysely<DB>,
  actor: ClassActor,
  input: { classId: string },
  now: Date,
): Promise<ClassResult> {
  const check = { classId: input.classId, action: "class_archived" } as const;
  return withAdminClass(db, actor, check, async (trx, locked) => {
    await trx
      .updateTable("organization")
      .set({ archived_at: now })
      .where("id", "=", locked.id)
      .execute();
    await recordAudit(trx, {
      action: "class_archived",
      actor: userActor(actor),
      outcome: "success",
      target: { type: "class", id: locked.id },
    });
    return done(null);
  });
}

/** Reopens any archived class (#37); a class that is not archived is `not_archived`. */
export function adminUnarchiveClass(
  db: Kysely<DB>,
  actor: ClassActor,
  input: { classId: string },
): Promise<ClassResult> {
  const check = {
    classId: input.classId,
    action: "class_unarchived",
    allowArchived: true,
  } as const;
  return withAdminClass(db, actor, check, async (trx, locked) => {
    if (!locked.archived) {
      await recordAdminRefusal(trx, actor, check.action, locked.id, "not_archived");
      return refused("not_archived");
    }
    await trx
      .updateTable("organization")
      .set({ archived_at: null })
      .where("id", "=", locked.id)
      .execute();
    await recordAudit(trx, {
      action: "class_unarchived",
      actor: userActor(actor),
      outcome: "success",
      target: { type: "class", id: locked.id },
    });
    return done(null);
  });
}

/**
 * Transfers the ownership of any class to a user whose app role includes teacher (#37), member
 * of the class or not, and who is not blocked. The old owner stays as a co-teacher while they
 * hold the app role teacher and leaves the class (and its lab groups) otherwise, so the class
 * keeps exactly one owner. Not when archived.
 */
export function adminTransferOwnership(
  db: Kysely<DB>,
  actor: ClassActor,
  input: { classId: string; userId: string },
  now: Date,
): Promise<ClassResult> {
  const check = { classId: input.classId, action: "class_owner_changed" } as const;
  return withAdminClass(db, actor, check, async (trx, locked) => {
    const unfit = await ownerRefusal(trx, input.userId, now);
    if (unfit) {
      await recordAdminRefusal(trx, actor, check.action, locked.id, unfit);
      return refused(unfit);
    }
    const owner = await trx
      .selectFrom("member")
      .innerJoin("user", "user.id", "member.userId")
      .select(["member.userId", "user.role as appRole"])
      .where("member.organizationId", "=", locked.id)
      .where("member.role", "=", "owner")
      .executeTakeFirst();
    if (owner?.userId === input.userId) {
      await recordAdminRefusal(trx, actor, check.action, locked.id, "already_owner");
      return refused("already_owner");
    }
    if (owner) {
      if (isAppTeacher(owner.appRole)) {
        await trx
          .updateTable("member")
          .set({ role: "teacher" })
          .where("organizationId", "=", locked.id)
          .where("userId", "=", owner.userId)
          .execute();
      } else {
        await removeFromClass(trx, locked.id, owner.userId);
      }
    }
    const updated = await trx
      .updateTable("member")
      .set({ role: "owner" })
      .where("organizationId", "=", locked.id)
      .where("userId", "=", input.userId)
      .executeTakeFirst();
    if (updated.numUpdatedRows === 0n) {
      await addMember(trx, locked.id, input.userId, "owner", now);
    }
    await recordAudit(trx, {
      action: "class_owner_changed",
      actor: userActor(actor),
      outcome: "success",
      target: { type: "class", id: locked.id },
      metadata: {
        user_id: input.userId,
        ...(owner ? { previous_user_id: owner.userId } : {}),
      },
    });
    return done(null);
  });
}

/** Removes `userId` from a class with their lab-group places in it. */
async function removeFromClass(trx: Kysely<DB>, classId: string, userId: string): Promise<void> {
  await trx
    .deleteFrom("teamMember")
    .where("userId", "=", userId)
    .where("teamId", "in", (q) =>
      q.selectFrom("team").select("id").where("organizationId", "=", classId),
    )
    .execute();
  await trx
    .deleteFrom("member")
    .where("organizationId", "=", classId)
    .where("userId", "=", userId)
    .execute();
  await refreshGroupCounts(trx, classId);
}

/**
 * Creates a class on a teacher's behalf (#37, B2): the chosen user, whose app role must include
 * teacher and who is not blocked, becomes its owner; the administrator does not become a member.
 *
 * @throws AuthError 403 without the app role admin.
 */
export async function adminCreateClass(
  db: Kysely<DB>,
  actor: ClassActor,
  input: ClassFields & { ownerId: string },
  now: Date,
): Promise<ClassResult<{ classId: string }>> {
  assertAdmin(actor);
  return db.transaction().execute(async (trx) => {
    const unfit = await ownerRefusal(trx, input.ownerId, now);
    if (unfit) {
      await recordAudit(trx, {
        action: "class_created",
        actor: userActor(actor),
        outcome: "refused",
        reason: unfit,
      });
      return refused<{ classId: string }>(unfit);
    }
    const classId = await insertClass(trx, input, now);
    await addMember(trx, classId, input.ownerId, "owner", now);
    await recordAudit(trx, {
      action: "class_created",
      actor: userActor(actor),
      outcome: "success",
      target: { type: "class", id: classId },
      metadata: { user_id: input.ownerId },
    });
    return done({ classId });
  });
}

/**
 * Returns the preview of a student list for any active class (#37, B2): every address with
 * what would happen to it (invalid, duplicate, already a member, already invited, or new).
 */
export function adminPreviewImport(
  db: Kysely<DB>,
  actor: ClassActor,
  input: { classId: string; emails: readonly string[] },
  now: Date,
): Promise<ClassResult<InviteRow[]>> {
  // NOTE: security review of #37; a preview writes nothing, so it records no refusal either.
  const check = {
    classId: input.classId,
    action: "invitation_created",
    record: false,
  } as const;
  return withAdminClass(db, actor, check, async (trx, locked) =>
    done(await classifyInvitees(trx, locked.id, "student", input.emails, now)),
  );
}

/**
 * Imports a student list into any active class (#37, B2) as pending student invitations, the
 * teacher's mechanism: nothing is granted until each address signs in itself (#28).
 */
export function adminImportStudents(
  db: Kysely<DB>,
  actor: ClassActor,
  input: { classId: string; emails: readonly string[] },
  now: Date,
): Promise<ClassResult<InviteOutcome>> {
  const check = { classId: input.classId, action: "invitation_created" } as const;
  return withAdminClass(db, actor, check, async (trx, locked) =>
    done(await writeInvitations(trx, actor.id, locked.id, "student", input.emails, now)),
  );
}
