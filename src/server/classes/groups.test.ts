// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { AuthError } from "../middleware.ts";
import { createClass } from "./classes.ts";
import {
  autoSplit,
  copyGroupSet,
  createGroups,
  deleteGroup,
  moveStudent,
  renameGroup,
  shuffle,
  splitIntoGroups,
} from "./groups.ts";
import { auditRows, classWithPeople, join, NOW, person } from "./test-helpers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function open(): Promise<Kysely<DB>> {
  db = await createTestDb();
  return db;
}

async function groupsOf(database: Kysely<DB>, classId: string) {
  const rows = await database
    .selectFrom("team")
    .leftJoin("teamMember", "teamMember.teamId", "team.id")
    .select(["team.id", "team.name", "team.group_set", "team.memberCount", "teamMember.userId"])
    .where("team.organizationId", "=", classId)
    .orderBy("team.group_set")
    .orderBy("team.name")
    .execute();
  return rows;
}

async function pairs(
  database: Kysely<DB>,
  classId: string,
  actor: { id: string; roles: readonly ("teacher" | "student" | "admin")[] },
) {
  const result = await createGroups(
    database,
    actor,
    { classId, groupSet: "Pairs", names: ["Group 1", "Group 2"] },
    NOW,
  );
  if (!result.ok) throw new Error(result.error);
  return result.value.groupIds;
}

describe("splitIntoGroups", () => {
  it("cuts 10 students into groups of at most 4 whose sizes differ by one", () => {
    const groups = splitIntoGroups([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4);
    expect(groups.map((group) => group.length)).toEqual([4, 3, 3]);
    expect(groups.flat()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("gives one group per student for size 1 and nothing for no students", () => {
    expect(splitIntoGroups(["a", "b"], 1)).toEqual([["a"], ["b"]]);
    expect(splitIntoGroups([], 3)).toEqual([]);
    expect(splitIntoGroups(["a"], 0)).toEqual([]);
  });
});

describe("shuffle", () => {
  it("permutes with the given picks and keeps every item", () => {
    expect(shuffle(["a", "b", "c"], () => 0)).toEqual(["b", "c", "a"]);
    expect(shuffle(["a", "b", "c"]).sort()).toEqual(["a", "b", "c"]);
  });
});

describe("createGroups, renameGroup, deleteGroup (#28)", () => {
  it("lets a co-teacher create groups in a named set, logged", async () => {
    const database = await open();
    const { classId, coTeacher } = await classWithPeople(database);
    await pairs(database, classId, coTeacher);
    const groups = await groupsOf(database, classId);
    expect(groups.map((group) => [group.group_set, group.name])).toEqual([
      ["Pairs", "Group 1"],
      ["Pairs", "Group 2"],
    ]);
    expect(await auditRows(database, "class_group_changed")).toEqual([
      expect.objectContaining({ metadata: { group_change: "created", count: 2 } }),
    ]);
  });

  it("refuses a name already used in the set, and allows it in another set", async () => {
    const database = await open();
    const { classId, owner } = await classWithPeople(database);
    await pairs(database, classId, owner);
    expect(
      await createGroups(database, owner, { classId, groupSet: "Pairs", names: ["Group 1"] }, NOW),
    ).toEqual({ ok: false, error: "group_name_taken" });
    expect(
      await createGroups(database, owner, { classId, groupSet: "Fours", names: ["Group 1"] }, NOW),
    ).toMatchObject({ ok: true });
  });

  it("renames and deletes a group", async () => {
    const database = await open();
    const { classId, owner } = await classWithPeople(database);
    const [first, second] = await pairs(database, classId, owner);
    expect(
      await renameGroup(database, owner, { classId, groupId: first ?? "", name: "Group 2" }, NOW),
    ).toEqual({
      ok: false,
      error: "group_name_taken",
    });
    expect(
      await renameGroup(database, owner, { classId, groupId: first ?? "", name: "Bench A" }, NOW),
    ).toEqual({
      ok: true,
      value: null,
    });
    expect(await deleteGroup(database, owner, { classId, groupId: second ?? "" })).toEqual({
      ok: true,
      value: null,
    });
    expect((await groupsOf(database, classId)).map((group) => group.name)).toEqual(["Bench A"]);
  });

  it("answers group_not_found to a group of another class", async () => {
    const database = await open();
    const one = await classWithPeople(database);
    const [group] = await pairs(database, one.classId, one.owner);
    const other = await createClass(
      database,
      one.owner,
      { name: "LS-2B", academicYear: "2026-2027" },
      NOW,
    );
    if (!other.ok) throw new Error(other.error);
    expect(
      await deleteGroup(database, one.owner, {
        classId: other.value.classId,
        groupId: group ?? "",
      }),
    ).toEqual({
      ok: false,
      error: "group_not_found",
    });
  });

  it("refuses a teacher of another class (not_found) and a student (403)", async () => {
    const database = await open();
    const { classId, outsider, studentA } = await classWithPeople(database);
    const input = { classId, groupSet: "Pairs", names: ["Group 1"] };
    expect(await createGroups(database, outsider, input, NOW)).toEqual({
      ok: false,
      error: "not_found",
    });
    await expect(createGroups(database, studentA, input, NOW)).rejects.toThrow(AuthError);
  });
});

describe("moveStudent (#28: at most one group per set)", () => {
  it("moves a student out of the other group of the same set", async () => {
    const database = await open();
    const { classId, owner, studentA } = await classWithPeople(database);
    const [first, second] = await pairs(database, classId, owner);
    const move = (groupId: string | null) =>
      moveStudent(
        database,
        owner,
        { classId, userId: studentA.id, groupSet: "Pairs", groupId },
        NOW,
      );
    expect(await move(first ?? null)).toEqual({ ok: true, value: null });
    expect(await move(second ?? null)).toEqual({ ok: true, value: null });
    const places = (await groupsOf(database, classId)).filter((row) => row.userId === studentA.id);
    expect(places.map((row) => [row.name, row.memberCount])).toEqual([["Group 2", 1]]);
    expect(await move(null)).toEqual({ ok: true, value: null });
    expect((await groupsOf(database, classId)).filter((row) => row.userId)).toEqual([]);
  });

  it("keeps a student's place in another set", async () => {
    const database = await open();
    const { classId, owner, studentA } = await classWithPeople(database);
    const [pair] = await pairs(database, classId, owner);
    const fours = await createGroups(
      database,
      owner,
      { classId, groupSet: "Fours", names: ["Four 1"] },
      NOW,
    );
    if (!fours.ok) throw new Error(fours.error);
    await moveStudent(
      database,
      owner,
      { classId, userId: studentA.id, groupSet: "Pairs", groupId: pair ?? null },
      NOW,
    );
    await moveStudent(
      database,
      owner,
      { classId, userId: studentA.id, groupSet: "Fours", groupId: fours.value.groupIds[0] ?? null },
      NOW,
    );
    const places = (await groupsOf(database, classId)).filter((row) => row.userId === studentA.id);
    expect(places.map((row) => row.name).sort()).toEqual(["Four 1", "Group 1"]);
  });

  it("refuses a co-teacher or a stranger as a group member", async () => {
    const database = await open();
    const { classId, owner, coTeacher, outsider } = await classWithPeople(database);
    const [group] = await pairs(database, classId, owner);
    for (const userId of [coTeacher.id, outsider.id]) {
      expect(
        await moveStudent(
          database,
          owner,
          { classId, userId, groupSet: "Pairs", groupId: group ?? null },
          NOW,
        ),
      ).toEqual({ ok: false, error: "not_class_student" });
    }
  });

  it("refuses a group of another set than the one named", async () => {
    const database = await open();
    const { classId, owner, studentA } = await classWithPeople(database);
    const [group] = await pairs(database, classId, owner);
    expect(
      await moveStudent(
        database,
        owner,
        { classId, userId: studentA.id, groupSet: "Fours", groupId: group ?? null },
        NOW,
      ),
    ).toEqual({ ok: false, error: "group_not_found" });
  });
});

describe("autoSplit", () => {
  it("splits the students alphabetically into named groups of the size", async () => {
    const database = await open();
    const { classId, owner, studentA, studentB } = await classWithPeople(database);
    const third = await person(database, "student-c", ["student"], { name: "Cy Test" });
    await join(database, classId, third.id, "student");
    const result = await autoSplit(
      database,
      owner,
      { classId, groupSet: "Pairs", size: 2, order: "alphabetical", prefix: "Group" },
      NOW,
    );
    expect(result.ok).toBe(true);
    const rows = await groupsOf(database, classId);
    expect(rows.map((row) => [row.name, row.userId])).toEqual([
      ["Group 1", expect.any(String)],
      ["Group 1", expect.any(String)],
      ["Group 2", third.id],
    ]);
    const first = rows
      .filter((row) => row.name === "Group 1")
      .map((row) => row.userId)
      .sort();
    expect(first).toEqual([studentA.id, studentB.id].sort());
  });

  it("splits at random with the given picks", async () => {
    const database = await open();
    const { classId, owner } = await classWithPeople(database);
    const result = await autoSplit(
      database,
      owner,
      { classId, groupSet: "Solo", size: 1, order: "random", prefix: "Bench" },
      NOW,
      () => 0,
    );
    expect(result.ok && result.value.groupIds).toHaveLength(2);
  });

  it("refuses a set that already has groups, and a class without students", async () => {
    const database = await open();
    const { classId, owner } = await classWithPeople(database);
    await pairs(database, classId, owner);
    const input = {
      classId,
      groupSet: "Pairs",
      size: 2,
      order: "alphabetical",
      prefix: "G",
    } as const;
    expect(await autoSplit(database, owner, input, NOW)).toEqual({
      ok: false,
      error: "group_set_exists",
    });
    const empty = await createClass(
      database,
      owner,
      { name: "Empty", academicYear: "2026-2027" },
      NOW,
    );
    if (!empty.ok) throw new Error(empty.error);
    expect(
      await autoSplit(database, owner, { ...input, classId: empty.value.classId }, NOW),
    ).toEqual({
      ok: false,
      error: "group_set_empty",
    });
  });
});

describe("copyGroupSet", () => {
  it("copies a group set of another class the teacher teaches, without members", async () => {
    const database = await open();
    const { classId, owner, studentA } = await classWithPeople(database);
    const [group] = await pairs(database, classId, owner);
    await moveStudent(
      database,
      owner,
      { classId, userId: studentA.id, groupSet: "Pairs", groupId: group ?? null },
      NOW,
    );
    const target = await createClass(
      database,
      owner,
      { name: "LS-2B", academicYear: "2026-2027" },
      NOW,
    );
    if (!target.ok) throw new Error(target.error);
    const input = { classId: target.value.classId, sourceClassId: classId, groupSet: "Pairs" };
    expect(await copyGroupSet(database, owner, input, NOW)).toEqual({
      ok: true,
      value: { count: 2 },
    });
    const rows = await groupsOf(database, target.value.classId);
    expect(rows.map((row) => [row.name, row.userId])).toEqual([
      ["Group 1", null],
      ["Group 2", null],
    ]);
    expect(await copyGroupSet(database, owner, input, NOW)).toEqual({
      ok: false,
      error: "group_set_exists",
    });
  });

  it("refuses a source class the teacher does not teach (not_found)", async () => {
    const database = await open();
    const { classId, owner, outsider } = await classWithPeople(database);
    await pairs(database, classId, owner);
    const own = await createClass(
      database,
      outsider,
      { name: "Mine", academicYear: "2026-2027" },
      NOW,
    );
    if (!own.ok) throw new Error(own.error);
    const input = { classId: own.value.classId, sourceClassId: classId, groupSet: "Pairs" };
    expect(await copyGroupSet(database, outsider, input, NOW)).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});
