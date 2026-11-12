// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { listAdminClassPage } from "./admin-queries.ts";
import { archiveClass, createClass } from "./classes.ts";
import { createGroups, moveStudent } from "./groups.ts";
import { createInvitations } from "./invitations.ts";
import {
  getTeacherClass,
  listGroupSetSources,
  listStudentClasses,
  listStudentInvitations,
  listTeacherClasses,
} from "./queries.ts";
import { classNotFoundLine, classWithPeople, NOW, person, securityLines } from "./test-helpers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function open(): Promise<Kysely<DB>> {
  db = await createTestDb();
  return db;
}

const DAY = 86_400_000;

describe("listTeacherClasses (D3: a membership query)", () => {
  it("lists the classes the teacher owns or co-teaches, with counts", async () => {
    const database = await open();
    const { classId, owner, coTeacher, outsider } = await classWithPeople(database);
    await createInvitations(
      database,
      owner,
      { classId, role: "student", emails: ["p@example.test"] },
      NOW,
    );
    const expected = {
      id: classId,
      name: "LS-2A",
      academicYear: "2026-2027",
      archivedAt: null,
      students: 2,
      teachers: 2,
      pendingInvitations: 1,
    };
    expect(await listTeacherClasses(database, owner.id, { archived: false }, NOW)).toEqual([
      { ...expected, myRole: "owner" },
    ]);
    expect(await listTeacherClasses(database, coTeacher.id, { archived: false }, NOW)).toEqual([
      { ...expected, myRole: "teacher" },
    ]);
    expect(await listTeacherClasses(database, outsider.id, { archived: false }, NOW)).toEqual([]);
  });

  it("shows an archived class only under the Archived filter", async () => {
    const database = await open();
    const { classId, owner } = await classWithPeople(database);
    await archiveClass(database, owner, { classId }, NOW);
    expect(await listTeacherClasses(database, owner.id, { archived: false }, NOW)).toEqual([]);
    const archived = await listTeacherClasses(database, owner.id, { archived: true }, NOW);
    expect(archived.map((row) => [row.id, row.archivedAt])).toEqual([[classId, NOW.toISOString()]]);
  });

  it("never lists a class to a student of it", async () => {
    const database = await open();
    const { studentA } = await classWithPeople(database);
    expect(await listTeacherClasses(database, studentA.id, { archived: false }, NOW)).toEqual([]);
  });

  it("orders by academic year (newest first), then name", async () => {
    const database = await open();
    const teacher = await person(database, "t", ["teacher"]);
    for (const [name, academicYear] of [
      ["B", "2026-2027"],
      ["A", "2026-2027"],
      ["C", "2027-2028"],
    ] as const) {
      await createClass(database, teacher, { name, academicYear }, NOW);
    }
    const rows = await listTeacherClasses(database, teacher.id, { archived: false }, NOW);
    expect(rows.map((row) => row.name)).toEqual(["C", "A", "B"]);
  });
});

describe("getTeacherClass", () => {
  it("returns members, pending invitations (expired ones flagged) and lab groups", async () => {
    const database = await open();
    const { classId, owner, studentA } = await classWithPeople(database);
    await createInvitations(
      database,
      owner,
      { classId, role: "student", emails: ["p@example.test"] },
      NOW,
    );
    const groups = await createGroups(
      database,
      owner,
      { classId, groupSet: "Pairs", names: ["Group 1"] },
      NOW,
    );
    if (!groups.ok) throw new Error(groups.error);
    await moveStudent(
      database,
      owner,
      {
        classId,
        userId: studentA.id,
        groupSet: "Pairs",
        groupId: groups.value.groupIds[0] ?? null,
      },
      NOW,
    );
    const later = new Date(NOW.getTime() + 31 * DAY);
    const page = await getTeacherClass(database, owner.id, classId, later);
    expect(page?.myRole).toBe("owner");
    expect(page?.members.map((member) => member.role)).toEqual([
      "owner",
      "teacher",
      "student",
      "student",
    ]);
    expect(page?.invitations).toEqual([
      expect.objectContaining({ email: "p@example.test", expired: true }),
    ]);
    expect(page?.groups).toEqual([
      {
        id: groups.value.groupIds[0],
        name: "Group 1",
        groupSet: "Pairs",
        memberIds: [studentA.id],
      },
    ]);
    expect(page?.groupSets).toEqual(["Pairs"]);
  });

  it("returns null to a teacher of another class, a student of it and an unknown id (D3, R-01)", async () => {
    const database = await open();
    const { classId, outsider, studentA } = await classWithPeople(database);
    const lines = await securityLines(async () => {
      expect(await getTeacherClass(database, outsider.id, classId, NOW)).toBeNull();
      expect(await getTeacherClass(database, studentA.id, classId, NOW)).toBeNull();
      expect(await getTeacherClass(database, outsider.id, "not-a-uuid", NOW)).toBeNull();
    });
    // Each probe leaves a trace (V16.3.2), ids only.
    expect(lines).toEqual([
      classNotFoundLine(outsider.id, classId),
      classNotFoundLine(studentA.id, classId),
      classNotFoundLine(outsider.id, "not-a-uuid"),
    ]);
  });
});

describe("listGroupSetSources", () => {
  it("lists the teacher's other classes with group sets, never another teacher's", async () => {
    const database = await open();
    const { classId, owner, outsider } = await classWithPeople(database);
    await createGroups(database, owner, { classId, groupSet: "Pairs", names: ["G1"] }, NOW);
    const target = await createClass(
      database,
      owner,
      { name: "LS-2B", academicYear: "2027-2028" },
      NOW,
    );
    if (!target.ok) throw new Error(target.error);
    const sources = await listGroupSetSources(database, owner.id, target.value.classId);
    expect(sources.map((source) => [source.id, source.groupSets])).toEqual([[classId, ["Pairs"]]]);
    expect(await listGroupSetSources(database, outsider.id, target.value.classId)).toEqual([]);
  });
});

describe("listAdminClassPage (#28, #37: oversight without grades or results, R-01)", () => {
  it("lists every class with owner, co-teachers and counts, and nothing else", async () => {
    const database = await open();
    const { classId, owner, coTeacher } = await classWithPeople(database);
    await createInvitations(
      database,
      owner,
      { classId, role: "student", emails: ["p@example.test"] },
      NOW,
    );
    const { rows } = await listAdminClassPage(database, {}, NOW);
    expect(rows).toEqual([
      {
        id: classId,
        name: "LS-2A",
        academicYear: "2026-2027",
        archivedAt: null,
        owner: { id: owner.id, name: "Test owner" },
        coTeachers: [{ id: coTeacher.id, name: "Test co-teacher" }],
        students: 2,
        pendingInvitations: 1,
      },
    ]);
  });
});

describe("listStudentClasses and listStudentInvitations (S2, R-01)", () => {
  it("lists only the classes the student belongs to", async () => {
    const database = await open();
    const { classId, studentA } = await classWithPeople(database);
    const stranger = await person(database, "stranger", ["student"]);
    expect((await listStudentClasses(database, studentA.id)).map((row) => row.id)).toEqual([
      classId,
    ]);
    expect(await listStudentClasses(database, stranger.id)).toEqual([]);
  });

  it("lists the pending, unexpired invitations for the student's own address only", async () => {
    const database = await open();
    const { classId, owner } = await classWithPeople(database);
    const joiner = await person(database, "joiner", ["student"]);
    await createInvitations(
      database,
      owner,
      { classId, role: "student", emails: [joiner.email, "other@example.test"] },
      NOW,
    );
    const own = await listStudentInvitations(database, joiner.id, NOW);
    expect(own).toEqual([
      expect.objectContaining({ className: "LS-2A", academicYear: "2026-2027" }),
    ]);
    const later = new Date(NOW.getTime() + 31 * DAY);
    expect(await listStudentInvitations(database, joiner.id, later)).toEqual([]);
  });

  it("shows an unverified student no invitations (security review of #28)", async () => {
    const database = await open();
    const { classId, owner } = await classWithPeople(database);
    const joiner = await person(database, "joiner", ["student"], { verified: false });
    await createInvitations(
      database,
      owner,
      { classId, role: "student", emails: [joiner.email] },
      NOW,
    );
    expect(await listStudentInvitations(database, joiner.id, NOW)).toEqual([]);
  });
});
