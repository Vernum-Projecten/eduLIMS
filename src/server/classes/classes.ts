// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The class itself (#28, B2): create, edit, archive, delete, copy to a new year, transfer the
// ownership and remove a member. Each write runs in one transaction with its activity-log row.
import "@tanstack/react-start/server-only";
import type { Kysely, Transaction } from "kysely";
import { type InvitationRole, memberPermission } from "../../lib/classes.ts";
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

function userActor(actor: ClassActor) {
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

async function insertClass(trx: Kysely<DB>, input: ClassFields, now: Date): Promise<string> {
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

async function addMember(
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
 * Returns whether a class holds work that deleting it would destroy. Until practicals exist,
 * a student member counts as work: their submissions and grades will hang off that membership.
 */
export async function classHasWork(trx: Kysely<DB>, classId: string): Promise<boolean> {
  // TODO(#98): refuse once practicals, submissions or grades of the class exist (D2, S6, D4).
  const student = await trx
    .selectFrom("member")
    .select("id")
    .where("organizationId", "=", classId)
    .where("role", "=", "student")
    .limit(1)
    .executeTakeFirst();
  return student !== undefined;
}

/**
 * Deletes a class created by mistake (the owner only): refused once the class holds work
 * (`has_work`) and for an archived class, which is history (#28).
 */
export function deleteClass(
  db: Kysely<DB>,
  actor: ClassActor,
  input: { classId: string },
): Promise<ClassResult> {
  const check = {
    classId: input.classId,
    permission: { class: ["delete"] },
    action: "class_deleted",
  } as const;
  return withClass(db, actor, check, async (trx, locked) => {
    if (await classHasWork(trx, locked.id)) {
      await recordAudit(trx, {
        action: "class_deleted",
        actor: userActor(actor),
        outcome: "refused",
        reason: "has_work",
        target: { type: "class", id: locked.id },
      });
      return refused("has_work");
    }
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

async function teachersToCopy(trx: Kysely<DB>, classId: string): Promise<string[]> {
  const rows = await trx
    .selectFrom("member")
    .innerJoin("user", "user.id", "member.userId")
    .select(["member.userId", "user.role"])
    .where("member.organizationId", "=", classId)
    .where("member.role", "=", "teacher")
    .orderBy("member.createdAt")
    .orderBy("member.id")
    .execute();
  // A co-teacher who lost the app role teacher is not carried over (#28).
  return rows
    .filter((row) => {
      const roles = validateRoleValue(row.role);
      return roles.ok && roles.roles.includes("teacher");
    })
    .map((row) => row.userId);
}

/**
 * Copies a class to a new academic year (the owner only, archived or not): the same name, the
 * new year, the same co-teachers and the same lab groups per group set, without students, group
 * members, invitations or work (#28). The actor owns the copy.
 */
export function copyClass(
  db: Kysely<DB>,
  actor: ClassActor,
  input: { classId: string; academicYear: string },
  now: Date,
): Promise<ClassResult<{ classId: string }>> {
  const check = {
    classId: input.classId,
    permission: { class: ["copy"] },
    action: "class_copied",
    allowArchived: true,
  } as const;
  return withClass(db, actor, check, async (trx, locked) => {
    const source = await trx
      .selectFrom("organization")
      .select("name")
      .where("id", "=", locked.id)
      .executeTakeFirstOrThrow();
    const classId = await insertClass(
      trx,
      { name: source.name, academicYear: input.academicYear },
      now,
    );
    await addMember(trx, classId, actor.id, "owner", now);
    for (const userId of await teachersToCopy(trx, locked.id)) {
      if (userId !== actor.id) await addMember(trx, classId, userId, "teacher", now);
    }
    await copyGroups(trx, locked.id, classId, null, now);
    await recordAudit(trx, {
      action: "class_copied",
      actor: userActor(actor),
      outcome: "success",
      target: { type: "class", id: classId },
      metadata: { class_id: locked.id },
    });
    return done({ classId });
  });
}

/**
 * Copies the lab groups of `fromClassId` (one group set, or all when `groupSet` is `null`) into
 * `toClassId` without their members; returns how many groups it created.
 */
export async function copyGroups(
  trx: Kysely<DB>,
  fromClassId: string,
  toClassId: string,
  groupSet: string | null,
  now: Date,
): Promise<number> {
  let query = trx
    .selectFrom("team")
    .select(["name", "group_set"])
    .where("organizationId", "=", fromClassId);
  if (groupSet !== null) query = query.where("group_set", "=", groupSet);
  const groups = await query.orderBy("group_set").orderBy("createdAt").orderBy("id").execute();
  if (groups.length === 0) return 0;
  await trx
    .insertInto("team")
    .values(
      groups.map((group) => ({
        id: newId(),
        name: group.name,
        group_set: group.group_set,
        organizationId: toClassId,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .execute();
  return groups.length;
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
    const target = await memberRole(trx, locked.id, input.userId);
    if (target !== "teacher") return refused("not_class_teacher");
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
  const role = await db.transaction().execute(async (trx: Transaction<DB>) => {
    const locked = await lockClass(trx, input.classId, actor.id);
    return locked ? memberRole(trx, locked.id, input.userId) : null;
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
