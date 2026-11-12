// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Copying a class to a new academic year, and copying lab groups between classes (#28).
import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import { validateRoleValue } from "../../lib/roles.ts";
import { recordAudit } from "../audit/record.ts";
import { newId } from "../db/ids.ts";
import type { DB } from "../db/schema.gen.ts";
import { type ClassActor, type ClassResult, done, withClass } from "./access.ts";
import { addMember, insertClass, userActor } from "./classes.ts";

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
