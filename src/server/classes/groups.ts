// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Lab groups (#28, owner decisions 8 and 9): better-auth teams inside the class, in named group
// sets. The owner and co-teachers manage them; students never do. A student is in at most one
// group per set: every write holds the class lock, so the check and the write agree.
import "@tanstack/react-start/server-only";
import { randomInt } from "node:crypto";
import type { Kysely, Transaction } from "kysely";
import { recordAudit } from "../audit/record.ts";
import { newId, UUID_PATTERN } from "../db/ids.ts";
import type { DB } from "../db/schema.gen.ts";
import {
  type ClassActor,
  type ClassResult,
  done,
  type LockedClass,
  refused,
  withClass,
} from "./access.ts";
import { copyGroups, memberRole, refreshGroupCounts } from "./classes.ts";

type GroupChange = "created" | "renamed" | "deleted" | "members" | "split" | "copied";

function groupCheck(classId: string) {
  return { classId, permission: { group: ["manage"] }, action: "class_group_changed" } as const;
}

async function logGroupChange(
  trx: Kysely<DB>,
  actor: ClassActor,
  classId: string,
  change: GroupChange,
  extra: { teamId?: string; count?: number },
): Promise<void> {
  await recordAudit(trx, {
    action: "class_group_changed",
    actor: { type: "user", id: actor.id },
    outcome: "success",
    target: { type: "class", id: classId },
    metadata: {
      group_change: change,
      ...(extra.teamId ? { team_id: extra.teamId } : {}),
      ...(extra.count === undefined ? {} : { count: extra.count }),
    },
  });
}

async function setNames(trx: Kysely<DB>, classId: string, groupSet: string): Promise<Set<string>> {
  const rows = await trx
    .selectFrom("team")
    .select("name")
    .where("organizationId", "=", classId)
    .where("group_set", "=", groupSet)
    .execute();
  return new Set(rows.map((row) => row.name));
}

async function insertGroups(
  trx: Kysely<DB>,
  classId: string,
  groupSet: string,
  names: readonly string[],
  now: Date,
): Promise<string[]> {
  const ids = names.map(() => newId());
  await trx
    .insertInto("team")
    .values(
      names.map((name, index) => ({
        id: ids[index] ?? newId(),
        name,
        group_set: groupSet,
        organizationId: classId,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .execute();
  return ids;
}

/** Creates groups with the given names in a group set, new or existing. */
export function createGroups(
  db: Kysely<DB>,
  actor: ClassActor,
  input: { classId: string; groupSet: string; names: readonly string[] },
  now: Date,
): Promise<ClassResult<{ groupIds: string[] }>> {
  return withClass(db, actor, groupCheck(input.classId), async (trx, locked) => {
    const groupSet = input.groupSet.trim();
    const names = input.names.map((name) => name.trim());
    const taken = await setNames(trx, locked.id, groupSet);
    if (new Set(names).size !== names.length || names.some((name) => taken.has(name))) {
      return refused("group_name_taken");
    }
    const groupIds = await insertGroups(trx, locked.id, groupSet, names, now);
    await logGroupChange(trx, actor, locked.id, "created", { count: names.length });
    return done({ groupIds });
  });
}

async function groupOf(
  trx: Kysely<DB>,
  locked: LockedClass,
  groupId: string,
): Promise<{ id: string; groupSet: string } | null> {
  if (!UUID_PATTERN.test(groupId)) return null;
  const row = await trx
    .selectFrom("team")
    .select(["id", "group_set"])
    .where("id", "=", groupId)
    .where("organizationId", "=", locked.id)
    .executeTakeFirst();
  return row ? { id: row.id, groupSet: row.group_set } : null;
}

/** Renames a group; the name stays unique within its group set. */
export function renameGroup(
  db: Kysely<DB>,
  actor: ClassActor,
  input: { classId: string; groupId: string; name: string },
  now: Date,
): Promise<ClassResult> {
  return withClass(db, actor, groupCheck(input.classId), async (trx, locked) => {
    const group = await groupOf(trx, locked, input.groupId);
    if (!group) return refused("group_not_found");
    const name = input.name.trim();
    const taken = await trx
      .selectFrom("team")
      .select("id")
      .where("organizationId", "=", locked.id)
      .where("group_set", "=", group.groupSet)
      .where("name", "=", name)
      .where("id", "<>", group.id)
      .executeTakeFirst();
    if (taken) return refused("group_name_taken");
    await trx
      .updateTable("team")
      .set({ name, updatedAt: now })
      .where("id", "=", group.id)
      .execute();
    await logGroupChange(trx, actor, locked.id, "renamed", { teamId: group.id });
    return done(null);
  });
}

/** Deletes a group; its students are left without a group in that set. */
export function deleteGroup(
  db: Kysely<DB>,
  actor: ClassActor,
  input: { classId: string; groupId: string },
): Promise<ClassResult> {
  return withClass(db, actor, groupCheck(input.classId), async (trx, locked) => {
    const group = await groupOf(trx, locked, input.groupId);
    if (!group) return refused("group_not_found");
    await trx.deleteFrom("team").where("id", "=", group.id).execute();
    await logGroupChange(trx, actor, locked.id, "deleted", { teamId: group.id });
    return done(null);
  });
}

async function leaveSet(
  trx: Kysely<DB>,
  classId: string,
  groupSet: string,
  userIds: readonly string[],
): Promise<void> {
  if (userIds.length === 0) return;
  await trx
    .deleteFrom("teamMember")
    .where("userId", "in", userIds)
    .where("teamId", "in", (q) =>
      q
        .selectFrom("team")
        .select("id")
        .where("organizationId", "=", classId)
        .where("group_set", "=", groupSet),
    )
    .execute();
}

/**
 * Moves a student of the class into a group, out of any other group of the same set; with
 * `groupId` `null`, out of every group of `groupSet`. Only students are grouped.
 */
export function moveStudent(
  db: Kysely<DB>,
  actor: ClassActor,
  input: { classId: string; userId: string; groupSet: string; groupId: string | null },
  now: Date,
): Promise<ClassResult> {
  return withClass(db, actor, groupCheck(input.classId), async (trx, locked) => {
    if ((await memberRole(trx, locked.id, input.userId)) !== "student") {
      return refused("not_class_student");
    }
    const group = input.groupId === null ? null : await groupOf(trx, locked, input.groupId);
    if (input.groupId !== null && (!group || group.groupSet !== input.groupSet.trim())) {
      return refused("group_not_found");
    }
    await leaveSet(trx, locked.id, input.groupSet.trim(), [input.userId]);
    if (group) {
      await trx
        .insertInto("teamMember")
        .values({ id: newId(), teamId: group.id, userId: input.userId, createdAt: now })
        .execute();
    }
    await refreshGroupCounts(trx, locked.id);
    await logGroupChange(trx, actor, locked.id, "members", {
      ...(group ? { teamId: group.id } : {}),
      count: 1,
    });
    return done(null);
  });
}

/** How auto-split orders the students before it cuts them into groups. */
export type SplitOrder = "random" | "alphabetical";

/**
 * Cuts `items` (already in order) into `ceil(n / size)` groups whose sizes differ by at most
 * one, each at most `size`: 10 students in groups of 4 gives 4, 3 and 3.
 */
export function splitIntoGroups<T>(items: readonly T[], size: number): T[][] {
  if (items.length === 0 || size < 1) return [];
  const count = Math.ceil(items.length / size);
  const base = Math.floor(items.length / count);
  const larger = items.length % count;
  const groups: T[][] = [];
  let start = 0;
  for (let index = 0; index < count; index += 1) {
    const length = base + (index < larger ? 1 : 0);
    groups.push(items.slice(start, start + length));
    start += length;
  }
  return groups;
}

/** Returns a shuffled copy of `items` (Fisher-Yates) with `pick(n)` in `[0, n)`. */
export function shuffle<T>(items: readonly T[], pick: (n: number) => number = randomInt): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = pick(index + 1);
    const held = copy[index];
    const swap = copy[other];
    if (held === undefined || swap === undefined) continue;
    copy[index] = swap;
    copy[other] = held;
  }
  return copy;
}

/**
 * Splits every student of the class into a new group set of groups of at most `size`, ordered
 * by name or at random, named `<prefix> 1`, `<prefix> 2`, …. A set that already has groups is
 * refused (`group_set_exists`), a class without students too (`group_set_empty`).
 */
export function autoSplit(
  db: Kysely<DB>,
  actor: ClassActor,
  input: { classId: string; groupSet: string; size: number; order: SplitOrder; prefix: string },
  now: Date,
  pick?: (n: number) => number,
): Promise<ClassResult<{ groupIds: string[] }>> {
  return withClass(db, actor, groupCheck(input.classId), async (trx, locked) => {
    const groupSet = input.groupSet.trim();
    if ((await setNames(trx, locked.id, groupSet)).size > 0) return refused("group_set_exists");
    const students = await trx
      .selectFrom("member")
      .innerJoin("user", "user.id", "member.userId")
      .select(["member.userId", "user.name"])
      .where("member.organizationId", "=", locked.id)
      .where("member.role", "=", "student")
      .orderBy("user.name")
      .orderBy("member.userId")
      .execute();
    if (students.length === 0) return refused("group_set_empty");
    const ordered = input.order === "random" ? shuffle(students, pick) : students;
    const parts = splitIntoGroups(ordered, input.size);
    const prefix = input.prefix.trim();
    const names = parts.map((_, index) => `${prefix} ${index + 1}`);
    const groupIds = await insertGroups(trx, locked.id, groupSet, names, now);
    const places = parts.flatMap((part, index) =>
      part.map((student) => ({
        id: newId(),
        teamId: groupIds[index] ?? "",
        userId: student.userId,
        createdAt: now,
      })),
    );
    await trx.insertInto("teamMember").values(places).execute();
    await refreshGroupCounts(trx, locked.id);
    await logGroupChange(trx, actor, locked.id, "split", { count: parts.length });
    return done({ groupIds });
  });
}

/**
 * Copies one group set of another class the actor teaches into this class, groups without
 * members. The source is checked by a membership query; a set name already in use is refused.
 */
export function copyGroupSet(
  db: Kysely<DB>,
  actor: ClassActor,
  input: { classId: string; sourceClassId: string; groupSet: string },
  now: Date,
): Promise<ClassResult<{ count: number }>> {
  return withClass(db, actor, groupCheck(input.classId), async (trx: Transaction<DB>, locked) => {
    const groupSet = input.groupSet.trim();
    if (!UUID_PATTERN.test(input.sourceClassId)) return refused("not_found");
    const source = await trx
      .selectFrom("member")
      .select("organizationId")
      .where("organizationId", "=", input.sourceClassId)
      .where("userId", "=", actor.id)
      .where("role", "in", ["owner", "teacher"])
      .executeTakeFirst();
    if (!source) return refused("not_found");
    if ((await setNames(trx, locked.id, groupSet)).size > 0) return refused("group_set_exists");
    const count = await copyGroups(trx, input.sourceClassId, locked.id, groupSet, now);
    if (count === 0) return refused("group_set_empty");
    await logGroupChange(trx, actor, locked.id, "copied", { count });
    return done({ count });
  });
}
