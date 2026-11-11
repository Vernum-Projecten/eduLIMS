// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { UUID_PATTERN } from "../db/ids.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { AuthError } from "../middleware.ts";
import {
  archiveClass,
  copyClass,
  createClass,
  deleteClass,
  removeMember,
  transferOwnership,
  updateClass,
} from "./classes.ts";
import { createGroups } from "./groups.ts";
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

async function roleOf(database: Kysely<DB>, classId: string, userId: string) {
  const row = await database
    .selectFrom("member")
    .select("role")
    .where("organizationId", "=", classId)
    .where("userId", "=", userId)
    .executeTakeFirst();
  return row?.role ?? null;
}

describe("createClass (#28)", () => {
  it("makes the teacher the owner of a class addressed by a UUIDv7 with the same slug", async () => {
    const database = await open();
    const teacher = await person(database, "t", ["teacher"]);
    const result = await createClass(
      database,
      teacher,
      { name: " LS-2A ", academicYear: "2026-2027" },
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { classId } = result.value;
    expect(classId).toMatch(UUID_PATTERN);
    expect(classId.charAt(14)).toBe("7");
    const row = await database
      .selectFrom("organization")
      .select(["name", "slug", "academic_year"])
      .where("id", "=", classId)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ name: "LS-2A", slug: classId, academic_year: "2026-2027" });
    expect(await roleOf(database, classId, teacher.id)).toBe("owner");
    expect(await auditRows(database, "class_created")).toEqual([
      expect.objectContaining({ actor_id: teacher.id, target_id: classId, outcome: "success" }),
    ]);
  });

  it("lets two classes share a name, told apart by the academic year", async () => {
    const database = await open();
    const teacher = await person(database, "t", ["teacher"]);
    const first = await createClass(
      database,
      teacher,
      { name: "LS-2A", academicYear: "2026-2027" },
      NOW,
    );
    const second = await createClass(
      database,
      teacher,
      { name: "LS-2A", academicYear: "2027-2028" },
      NOW,
    );
    expect([first.ok, second.ok]).toEqual([true, true]);
  });

  it.each([
    ["a student", ["student"] as const],
    ["an administrator without the teacher role", ["admin"] as const],
  ])("refuses %s with 403", async (_label, roles) => {
    const database = await open();
    const actor = await person(database, "x", roles);
    await expect(
      createClass(database, actor, { name: "LS-2A", academicYear: "2026-2027" }, NOW),
    ).rejects.toThrow(AuthError);
  });

  it("refuses an academic year whose second year does not follow the first (database CHECK)", async () => {
    const database = await open();
    const teacher = await person(database, "t", ["teacher"]);
    await expect(
      createClass(database, teacher, { name: "LS-2A", academicYear: "2026-2028" }, NOW),
    ).rejects.toThrow(/check constraint/);
  });
});

describe("updateClass", () => {
  it("lets the owner rename the class", async () => {
    const database = await open();
    const { classId, owner } = await classWithPeople(database);
    const input = { classId, name: "LS-2B", academicYear: "2026-2027" };
    expect(await updateClass(database, owner, input)).toEqual({ ok: true, value: null });
  });

  it("refuses a co-teacher (forbidden) and logs the refusal", async () => {
    const database = await open();
    const { classId, coTeacher } = await classWithPeople(database);
    const input = { classId, name: "LS-2B", academicYear: "2026-2027" };
    expect(await updateClass(database, coTeacher, input)).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await auditRows(database, "class_updated")).toEqual([
      expect.objectContaining({
        outcome: "refused",
        reason_code: "forbidden",
        actor_id: coTeacher.id,
      }),
    ]);
  });

  it("answers not_found to a teacher of another class (D3)", async () => {
    const database = await open();
    const { classId, outsider } = await classWithPeople(database);
    const input = { classId, name: "LS-2B", academicYear: "2026-2027" };
    expect(await updateClass(database, outsider, input)).toEqual({ ok: false, error: "not_found" });
  });

  it("answers not_found to an id that is no UUID", async () => {
    const database = await open();
    const { owner } = await classWithPeople(database);
    const input = { classId: "LS-2A", name: "LS-2B", academicYear: "2026-2027" };
    expect(await updateClass(database, owner, input)).toEqual({ ok: false, error: "not_found" });
  });

  it("refuses a student of the class with 403", async () => {
    const database = await open();
    const { classId, studentA } = await classWithPeople(database);
    const input = { classId, name: "LS-2B", academicYear: "2026-2027" };
    await expect(updateClass(database, studentA, input)).rejects.toThrow(AuthError);
  });
});

describe("archiveClass", () => {
  it("makes the class read-only for edits, removals and groups", async () => {
    const database = await open();
    const { classId, owner, studentA } = await classWithPeople(database);
    expect(await archiveClass(database, owner, { classId }, NOW)).toEqual({
      ok: true,
      value: null,
    });
    const edit = { classId, name: "LS-2B", academicYear: "2026-2027" };
    expect(await updateClass(database, owner, edit)).toEqual({ ok: false, error: "archived" });
    expect(await removeMember(database, owner, { classId, userId: studentA.id })).toEqual({
      ok: false,
      error: "archived",
    });
    const groups = { classId, groupSet: "Pairs", names: ["Group 1"] };
    expect(await createGroups(database, owner, groups, NOW)).toEqual({
      ok: false,
      error: "archived",
    });
    expect(await archiveClass(database, owner, { classId }, NOW)).toEqual({
      ok: false,
      error: "archived",
    });
  });

  it("keeps the members of an archived class", async () => {
    const database = await open();
    const { classId, owner } = await classWithPeople(database);
    await archiveClass(database, owner, { classId }, NOW);
    const members = await database
      .selectFrom("member")
      .select("id")
      .where("organizationId", "=", classId)
      .execute();
    expect(members).toHaveLength(4);
  });

  it("refuses a co-teacher", async () => {
    const database = await open();
    const { classId, coTeacher } = await classWithPeople(database);
    expect(await archiveClass(database, coTeacher, { classId }, NOW)).toEqual({
      ok: false,
      error: "forbidden",
    });
  });
});

describe("deleteClass", () => {
  it("is refused once the class has students (has_work), and logged", async () => {
    const database = await open();
    const { classId, owner } = await classWithPeople(database);
    expect(await deleteClass(database, owner, { classId })).toEqual({
      ok: false,
      error: "has_work",
    });
    expect(await auditRows(database, "class_deleted")).toEqual([
      expect.objectContaining({ outcome: "refused", reason_code: "has_work" }),
    ]);
  });

  it("deletes a class created by mistake", async () => {
    const database = await open();
    const owner = await person(database, "owner", ["teacher"]);
    const created = await createClass(
      database,
      owner,
      { name: "Typo", academicYear: "2026-2027" },
      NOW,
    );
    if (!created.ok) throw new Error(created.error);
    const { classId } = created.value;
    expect(await deleteClass(database, owner, { classId })).toEqual({ ok: true, value: null });
    const left = await database.selectFrom("organization").select("id").execute();
    expect(left).toEqual([]);
  });

  it("refuses a co-teacher and a teacher of another class", async () => {
    const database = await open();
    const { classId, coTeacher, outsider } = await classWithPeople(database);
    expect(await deleteClass(database, coTeacher, { classId })).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await deleteClass(database, outsider, { classId })).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});

describe("copyClass (#28: copy to a new year)", () => {
  it("copies the name, the co-teachers and the group sets, without students", async () => {
    const database = await open();
    const { classId, owner, coTeacher, studentA } = await classWithPeople(database);
    await createGroups(
      database,
      owner,
      { classId, groupSet: "Pairs", names: ["Group 1", "Group 2"] },
      NOW,
    );
    await archiveClass(database, owner, { classId }, NOW);
    const copied = await copyClass(database, owner, { classId, academicYear: "2027-2028" }, NOW);
    expect(copied.ok).toBe(true);
    if (!copied.ok) return;
    const copyId = copied.value.classId;
    const row = await database
      .selectFrom("organization")
      .select(["name", "academic_year", "archived_at"])
      .where("id", "=", copyId)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ name: "LS-2A", academic_year: "2027-2028", archived_at: null });
    expect(await roleOf(database, copyId, owner.id)).toBe("owner");
    expect(await roleOf(database, copyId, coTeacher.id)).toBe("teacher");
    expect(await roleOf(database, copyId, studentA.id)).toBeNull();
    const groups = await database
      .selectFrom("team")
      .select(["name", "group_set", "memberCount"])
      .where("organizationId", "=", copyId)
      .orderBy("name")
      .execute();
    expect(groups).toEqual([
      { name: "Group 1", group_set: "Pairs", memberCount: 0 },
      { name: "Group 2", group_set: "Pairs", memberCount: 0 },
    ]);
    expect(await auditRows(database, "class_copied")).toEqual([
      expect.objectContaining({ target_id: copyId, metadata: { class_id: classId } }),
    ]);
  });

  it("leaves out a co-teacher who lost the app role teacher", async () => {
    const database = await open();
    const { classId, owner, coTeacher } = await classWithPeople(database);
    await database
      .updateTable("user")
      .set({ role: "admin" })
      .where("id", "=", coTeacher.id)
      .execute();
    const copied = await copyClass(database, owner, { classId, academicYear: "2027-2028" }, NOW);
    if (!copied.ok) throw new Error(copied.error);
    expect(await roleOf(database, copied.value.classId, coTeacher.id)).toBeNull();
  });

  it("refuses a co-teacher", async () => {
    const database = await open();
    const { classId, coTeacher } = await classWithPeople(database);
    expect(
      await copyClass(database, coTeacher, { classId, academicYear: "2027-2028" }, NOW),
    ).toEqual({
      ok: false,
      error: "forbidden",
    });
  });
});

describe("transferOwnership", () => {
  it("hands the class to a co-teacher, who keeps one owner", async () => {
    const database = await open();
    const { classId, owner, coTeacher } = await classWithPeople(database);
    const result = await transferOwnership(database, owner, { classId, userId: coTeacher.id });
    expect(result).toEqual({ ok: true, value: null });
    expect(await roleOf(database, classId, coTeacher.id)).toBe("owner");
    expect(await roleOf(database, classId, owner.id)).toBe("teacher");
    expect(await auditRows(database, "class_owner_changed")).toEqual([
      expect.objectContaining({ metadata: { user_id: coTeacher.id } }),
    ]);
  });

  it("refuses a student or a stranger as the new owner", async () => {
    const database = await open();
    const { classId, owner, studentA, outsider } = await classWithPeople(database);
    for (const userId of [studentA.id, outsider.id]) {
      expect(await transferOwnership(database, owner, { classId, userId })).toEqual({
        ok: false,
        error: "not_class_teacher",
      });
    }
  });

  it("refuses a co-teacher", async () => {
    const database = await open();
    const { classId, owner, coTeacher } = await classWithPeople(database);
    expect(await transferOwnership(database, coTeacher, { classId, userId: owner.id })).toEqual({
      ok: false,
      error: "forbidden",
    });
  });
});

describe("removeMember", () => {
  it("never removes the owner", async () => {
    const database = await open();
    const { classId, owner, coTeacher } = await classWithPeople(database);
    for (const actor of [owner, coTeacher]) {
      expect(await removeMember(database, actor, { classId, userId: owner.id })).toEqual({
        ok: false,
        error: "owner_not_removable",
      });
    }
  });

  it("lets a co-teacher remove a student, with their group places", async () => {
    const database = await open();
    const { classId, coTeacher, studentA } = await classWithPeople(database);
    expect(await removeMember(database, coTeacher, { classId, userId: studentA.id })).toEqual({
      ok: true,
      value: null,
    });
    expect(await roleOf(database, classId, studentA.id)).toBeNull();
    expect(await auditRows(database, "class_member_removed")).toEqual([
      expect.objectContaining({ metadata: { user_id: studentA.id, class_role: "student" } }),
    ]);
  });

  it("lets only the owner remove a co-teacher", async () => {
    const database = await open();
    const { classId, owner, coTeacher } = await classWithPeople(database);
    const second = await person(database, "second", ["teacher"]);
    await join(database, classId, second.id, "teacher");
    expect(await removeMember(database, coTeacher, { classId, userId: second.id })).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await removeMember(database, owner, { classId, userId: second.id })).toEqual({
      ok: true,
      value: null,
    });
  });

  it("answers not_found to a teacher of another class", async () => {
    const database = await open();
    const { classId, outsider, studentA } = await classWithPeople(database);
    expect(await removeMember(database, outsider, { classId, userId: studentA.id })).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("refuses a student with 403", async () => {
    const database = await open();
    const { classId, studentA, studentB } = await classWithPeople(database);
    await expect(
      removeMember(database, studentA, { classId, userId: studentB.id }),
    ).rejects.toThrow(AuthError);
  });
});

describe("the database rules of a class", () => {
  it("holds at most one owner per class", async () => {
    const database = await open();
    const { classId, coTeacher } = await classWithPeople(database);
    await expect(
      database
        .updateTable("member")
        .set({ role: "owner" })
        .where("organizationId", "=", classId)
        .where("userId", "=", coTeacher.id)
        .execute(),
    ).rejects.toThrow(/member_one_owner/);
  });

  it("refuses a slug other than the id", async () => {
    const database = await open();
    const { classId } = await classWithPeople(database);
    await expect(
      database
        .updateTable("organization")
        .set({ slug: "ls-2a" })
        .where("id", "=", classId)
        .execute(),
    ).rejects.toThrow(/organization_slug_is_id/);
  });
});
