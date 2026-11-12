// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The class itself (#28, B2): create, edit, archive, delete, copy to a new year, transfer the
// ownership and remove a member. Each write runs in one transaction with its activity-log row.
import "@tanstack/react-start/server-only";
import type { Kysely, Transaction } from "kysely";
import { type InvitationRole, isTeachingRole, memberPermission } from "../../lib/classes.ts";
import { validateRoleValue } from "../../lib/roles.ts";
import { recordAudit } from "../audit/record.ts";
import { newId } from "../db/ids.ts";
import type { DB } from "../db/schema.gen.ts";
import {
  assertTeacher,
  type ClassActor,
  type ClassResult,
  done,
  lockClass,
  refused,
  withClass,
} from "./access.ts";

/** The fields of a class a teacher types. */
export interface ClassFields {
  name: string;
  academicYear: string;
}

export function userActor(actor: ClassActor) {
  return { type: "user", id: actor.id } as const;
}

/**
 * Creates a class with the actor as its `owner` (#28: only the app role teacher creates one).
 * The id is a UUIDv7 and the slug the same id, so names may repeat across years.
 *
 * @throws AuthError 403 without the app role teacher.
 */
export async function createClass(
  db: Kysely<DB>,
  actor: ClassActor,
  input: ClassFields,
  now: Date,
): Promise<ClassResult<{ classId: string }>> {
  assertTeacher(actor);
  return db.transaction().execute(async (trx) => {
    const classId = await insertClass(trx, input, now);
    await addMember(trx, classId, actor.id, "owner", now);
    await recordAudit(trx, {
      action: "class_created",
      actor: userActor(actor),
      outcome: "success",
      target: { type: "class", id: classId },
    });
    return done({ classId });
  });
}

export async function insertClass(trx: Kysely<DB>, input: ClassFields, now: Date): Promise<string> {
  const id = newId();
  await trx
    .insertInto("organization")
    .values({
      id,
      slug: id,
      name: input.name.trim(),
      academic_year: input.academicYear.trim(),
      createdAt: now,
    })
    .execute();
  return id;
}

export async function addMember(
  trx: Kysely<DB>,
  classId: string,
  userId: string,
  role: "owner" | InvitationRole,
  now: Date,
): Promise<void> {
  await trx
    .insertInto("member")
    .values({ id: newId(), organizationId: classId, userId, role, createdAt: now })
    .execute();
}

/** Renames a class or changes its academic year (the owner only; not when archived). */
export function updateClass(
  db: Kysely<DB>,
  actor: ClassActor,
  input: ClassFields & { classId: string },
): Promise<ClassResult> {
  const check = {
    classId: input.classId,
    permission: { class: ["update"] },
    action: "class_updated",
  } as const;
  return withClass(db, actor, check, async (trx, locked) => {
    await trx
      .updateTable("organization")
      .set({ name: input.name.trim(), academic_year: input.academicYear.trim() })
      .where("id", "=", locked.id)
      .execute();
    await recordAudit(trx, {
      action: "class_updated",
      actor: userActor(actor),
      outcome: "success",
      target: { type: "class", id: locked.id },
    });
    return done(null);
  });
}

/**
 * Archives a class (the owner only): it becomes read-only and leaves the default list, and
 * keeps its members, groups and invitations (#28). Archiving an archived class is `archived`.
 */
export function archiveClass(
  db: Kysely<DB>,
  actor: ClassActor,
  input: { classId: string },
  now: Date,
): Promise<ClassResult> {
  const check = {
    classId: input.classId,
    permission: { class: ["archive"] },
    action: "class_archived",
  } as const;
  return withClass(db, actor, check, async (trx, locked) => {
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

/**
 * Reopens an archived class (the owner only, owner decision on #28): it is writable again and
 * back in the default list. Reopening a class that is not archived is `not_archived`.
 */
export function unarchiveClass(
  db: Kysely<DB>,
  actor: ClassActor,
  input: { classId: string },
): Promise<ClassResult> {
  const check = {
    classId: input.classId,
    permission: { class: ["unarchive"] },
    action: "class_unarchived",
    allowArchived: true,
  } as const;
  return withClass(db, actor, check, async (trx, locked) => {
    if (!locked.archived) return refused("not_archived");
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
 * Returns whether a class holds work that deleting it would destroy: practicals, submissions or
 * grades (owner decision on #28). Members, invitations and lab groups are not work.
 */
export async function classHasWork(_trx: Kysely<DB>, _classId: string): Promise<boolean> {
  // TODO(#98): refuse once practicals, submissions or grades of the class exist (D2, S6, D4).
  return false;
}

/**
 * Deletes a class created by mistake (the owner only), with its memberships, invitations and lab
 * groups in the same transaction; refused once the class holds work (`has_work`, `hasWork`) and
 * for an archived class, which is history (#28).
 */
export function deleteClass(
  db: Kysely<DB>,
  actor: ClassActor,
  input: { classId: string },
  hasWork: (trx: Kysely<DB>, classId: string) => Promise<boolean> = classHasWork,
): Promise<ClassResult> {
  const check = {
    classId: input.classId,
    permission: { class: ["delete"] },
    action: "class_deleted",
  } as const;
  return withClass(db, actor, check, async (trx, locked) => {
    if (await hasWork(trx, locked.id)) {
      await recordAudit(trx, {
        action: "class_deleted",
        actor: userActor(actor),
        outcome: "refused",
        reason: "has_work",
        target: { type: "class", id: locked.id },
      });
      return refused("has_work");
    }
    // The foreign keys cascade: members, invitations, lab groups and their places go with it.
    await trx.deleteFrom("organization").where("id", "=", locked.id).execute();
    await recordAudit(trx, {
      action: "class_deleted",
      actor: userActor(actor),
      outcome: "success",
      target: { type: "class", id: locked.id },
    });
    return done(null);
  });
}

/**
 * Transfers the ownership of a class to one of its co-teachers (the owner only; not when
 * archived). The old owner stays as a co-teacher, so the class keeps exactly one owner.
 */
export function transferOwnership(
  db: Kysely<DB>,
  actor: ClassActor,
  input: { classId: string; userId: string },
): Promise<ClassResult> {
  const check = {
    classId: input.classId,
    permission: { class: ["transfer"] },
    action: "class_owner_changed",
  } as const;
  return withClass(db, actor, check, async (trx, locked) => {
    const target = await trx
      .selectFrom("member")
      .innerJoin("user", "user.id", "member.userId")
      .select(["member.role", "user.role as appRole"])
      .where("member.organizationId", "=", locked.id)
      .where("member.userId", "=", input.userId)
      .executeTakeFirst();
    const appRoles = validateRoleValue(target?.appRole);
    // A co-teacher who lost the app role teacher cannot take the class over (#28).
    if (target?.role !== "teacher" || !appRoles.ok || !appRoles.roles.includes("teacher")) {
      return refused("not_class_teacher");
    }
    await trx
      .updateTable("member")
      .set({ role: "teacher" })
      .where("organizationId", "=", locked.id)
      .where("role", "=", "owner")
      .execute();
    await trx
      .updateTable("member")
      .set({ role: "owner" })
      .where("organizationId", "=", locked.id)
      .where("userId", "=", input.userId)
      .execute();
    await recordAudit(trx, {
      action: "class_owner_changed",
      actor: userActor(actor),
      outcome: "success",
      target: { type: "class", id: locked.id },
      metadata: { user_id: input.userId },
    });
    return done(null);
  });
}

/** Returns the class role of `userId` in a class, or `null` for no member. */
export async function memberRole(
  trx: Kysely<DB>,
  classId: string,
  userId: string,
): Promise<string | null> {
  const row = await trx
    .selectFrom("member")
    .select("role")
    .where("organizationId", "=", classId)
    .where("userId", "=", userId)
    .executeTakeFirst();
  return row?.role ?? null;
}

/**
 * Removes a member from a class, with their lab-group places in it. The owner is never removed
 * (`owner_not_removable`; transfer the ownership first); a co-teacher removes students only,
 * the owner co-teachers too. Not when archived.
 */
export async function removeMember(
  db: Kysely<DB>,
  actor: ClassActor,
  input: { classId: string; userId: string },
): Promise<ClassResult> {
  assertTeacher(actor);
  // Only a teacher of the class learns the target's role; anyone else gets `not_found` below.
  const role = await db.transaction().execute(async (trx: Transaction<DB>) => {
    const locked = await lockClass(trx, input.classId, actor.id);
    return locked && isTeachingRole(locked.role) ? memberRole(trx, locked.id, input.userId) : null;
  });
  if (role === "owner") return refused("owner_not_removable");
  const targetRole: InvitationRole = role === "teacher" ? "teacher" : "student";
  const check = {
    classId: input.classId,
    permission: memberPermission(targetRole, "remove"),
    action: "class_member_removed",
  } as const;
  return withClass(db, actor, check, async (trx, locked) => {
    // Read again under the lock: the role may have changed since the first read.
    const current = await memberRole(trx, locked.id, input.userId);
    if (current === null) return refused("not_found");
    if (current !== role) return refused("forbidden");
    await trx
      .deleteFrom("teamMember")
      .where("userId", "=", input.userId)
      .where("teamId", "in", (q) =>
        q.selectFrom("team").select("id").where("organizationId", "=", locked.id),
      )
      .execute();
    await trx
      .deleteFrom("member")
      .where("organizationId", "=", locked.id)
      .where("userId", "=", input.userId)
      .execute();
    await refreshGroupCounts(trx, locked.id);
    await recordAudit(trx, {
      action: "class_member_removed",
      actor: userActor(actor),
      outcome: "success",
      target: { type: "class", id: locked.id },
      metadata: { user_id: input.userId, class_role: targetRole },
    });
    return done(null);
  });
}

/** Keeps better-auth's cached `team.memberCount` in step with the group places of a class. */
export async function refreshGroupCounts(trx: Kysely<DB>, classId: string): Promise<void> {
  await trx
    .updateTable("team")
    .set((eb) => ({
      memberCount: eb
        .selectFrom("teamMember")
        .select((s) => s.fn.countAll<number>().as("n"))
        .whereRef("teamMember.teamId", "=", "team.id"),
    }))
    .where("organizationId", "=", classId)
    .execute();
}
