// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The administrator's class reads (#37) against a real database: search, the archive,
// academic-year and owner facets with their counts, server paging, the class detail without
// grades or results (R-01), and the teachers who can own a class.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { AuthError } from "../middleware.ts";
import type { ClassActor } from "./access.ts";
import { getAdminClass, listAdminClassPage, searchTeacherCandidates } from "./admin-queries.ts";
import { archiveClass, createClass } from "./classes.ts";
import { createGroups } from "./groups.ts";
import { createInvitations } from "./invitations.ts";
import { classWithPeople, join, NOW, person } from "./test-helpers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function open(): Promise<Kysely<DB>> {
  db = await createTestDb();
  return db;
}

const DAY = 24 * 60 * 60 * 1000;

/** The viewer of the reads: the reads need the app role admin only, not an account. */
const ADMIN = { roles: ["admin"] } as const;

async function newClass(
  database: Kysely<DB>,
  owner: ClassActor,
  name: string,
  academicYear: string,
): Promise<string> {
  const created = await createClass(database, owner, { name, academicYear }, NOW);
  if (!created.ok) throw new Error(created.error);
  return created.value.classId;
}

/** Four classes of two owners over two years, one of them archived. */
async function fourClasses(database: Kysely<DB>) {
  const ada = await person(database, "ada", ["teacher"], { name: "Ada Teacher" });
  const bo = await person(database, "bo", ["teacher"], { name: "Bo Teacher" });
  const a1 = await newClass(database, ada, "LS-1A", "2026-2027");
  const a2 = await newClass(database, ada, "LS-2A", "2025-2026");
  const b1 = await newClass(database, bo, "MB-1A", "2026-2027");
  const b2 = await newClass(database, bo, "MB-2A", "2025-2026");
  await archiveClass(database, bo, { classId: b2 }, NOW);
  return { ada, bo, a1, a2, b1, b2 };
}

describe("listAdminClassPage (#37)", () => {
  it("lists every class, newest academic year first, then by name", async () => {
    const database = await open();
    const { a1, a2, b1, b2 } = await fourClasses(database);
    const page = await listAdminClassPage(database, ADMIN, {}, NOW);
    expect(page.rows.map((row) => row.id)).toEqual([a1, b1, a2, b2]);
    expect(page).toEqual(expect.objectContaining({ total: 4, page: 1, size: 25 }));
  });

  it("searches the class name and the names of its teachers", async () => {
    const database = await open();
    const { a1, a2, b1 } = await fourClasses(database);
    const byClass = await listAdminClassPage(database, ADMIN, { q: "mb-1" }, NOW);
    expect(byClass.rows.map((row) => row.id)).toEqual([b1]);
    const byTeacher = await listAdminClassPage(database, ADMIN, { q: "ada" }, NOW);
    expect(byTeacher.rows.map((row) => row.id)).toEqual([a1, a2]);
  });

  it("treats LIKE wildcards in the search as plain text", async () => {
    const database = await open();
    await fourClasses(database);
    expect((await listAdminClassPage(database, ADMIN, { q: "%" }, NOW)).total).toBe(0);
  });

  it("filters on the archive state, the academic year and the owner", async () => {
    const database = await open();
    const { ada, a1, a2, b1, b2 } = await fourClasses(database);
    const ids = async (input: Parameters<typeof listAdminClassPage>[2]) =>
      (await listAdminClassPage(database, ADMIN, input, NOW)).rows.map((row) => row.id);
    expect(await ids({ status: ["archived"] })).toEqual([b2]);
    expect(await ids({ status: ["active"] })).toEqual([a1, b1, a2]);
    expect(await ids({ status: ["active", "archived"] })).toEqual([a1, b1, a2, b2]);
    expect(await ids({ year: ["2025-2026"] })).toEqual([a2, b2]);
    expect(await ids({ owner: [ada.id] })).toEqual([a1, a2]);
    expect(await ids({ owner: [ada.id], year: ["2026-2027"], status: ["active"] })).toEqual([a1]);
  });

  it("counts each facet under the search and the other facets, not its own", async () => {
    const database = await open();
    const { ada, bo } = await fourClasses(database);
    const page = await listAdminClassPage(
      database,
      ADMIN,
      { status: ["archived"], owner: [ada.id] },
      NOW,
    );
    expect(page.total).toBe(0);
    expect(page.facets.status).toEqual({ active: 2, archived: 0 });
    expect(page.facets.owner).toEqual([
      { value: ada.id, label: "Ada Teacher", count: 0 },
      { value: bo.id, label: "Bo Teacher", count: 1 },
    ]);
    expect(page.facets.year).toEqual([
      { value: "2026-2027", label: "2026-2027", count: 0 },
      { value: "2025-2026", label: "2025-2026", count: 0 },
    ]);
    const all = await listAdminClassPage(database, ADMIN, {}, NOW);
    expect(all.facets.year).toEqual([
      { value: "2026-2027", label: "2026-2027", count: 2 },
      { value: "2025-2026", label: "2025-2026", count: 2 },
    ]);
  });

  it("pages on the server with the total, and counts past the last page", async () => {
    const database = await open();
    const { a2, b2 } = await fourClasses(database);
    const second = await listAdminClassPage(database, ADMIN, { page: 2, size: 10 }, NOW);
    expect(second.rows).toEqual([]);
    expect(second.total).toBe(4);
    const firstOfTwo = await listAdminClassPage(database, ADMIN, { size: 10 }, NOW);
    expect(firstOfTwo.rows).toHaveLength(4);
    expect(firstOfTwo.rows.slice(2).map((row) => row.id)).toEqual([a2, b2]);
  });

  it("returns no grades, results or e-mail addresses in a row (R-01)", async () => {
    const database = await open();
    await classWithPeople(database);
    const [row] = (await listAdminClassPage(database, ADMIN, {}, NOW)).rows;
    expect(Object.keys(row ?? {}).sort()).toEqual([
      "academicYear",
      "archivedAt",
      "coTeachers",
      "id",
      "name",
      "owner",
      "pendingInvitations",
      "students",
    ]);
  });
});

describe("getAdminClass (#37, R-01)", () => {
  it("returns members by name and role, invitations and counts, for no member", async () => {
    const database = await open();
    const { classId, owner, coTeacher, studentA, studentB } = await classWithPeople(database);
    await createInvitations(
      database,
      owner,
      { classId, role: "student", emails: ["p@example.test", "q@example.test"] },
      NOW,
    );
    await createGroups(database, owner, { classId, groupSet: "Pairs", names: ["P1", "P2"] }, NOW);
    const later = new Date(NOW.getTime() + DAY);
    const page = await getAdminClass(database, ADMIN, classId, later);
    expect(page).toEqual({
      id: classId,
      name: "LS-2A",
      academicYear: "2026-2027",
      archivedAt: null,
      owner: { id: owner.id, name: "Test owner" },
      members: [
        { userId: owner.id, name: "Test owner", role: "owner" },
        { userId: coTeacher.id, name: "Test co-teacher", role: "teacher" },
        { userId: studentA.id, name: "Ada Test", role: "student" },
        { userId: studentB.id, name: "Bo Test", role: "student" },
      ],
      invitations: [
        expect.objectContaining({ email: "p@example.test", role: "student", expired: false }),
        expect.objectContaining({ email: "q@example.test", role: "student", expired: false }),
      ],
      counts: { teachers: 2, students: 2, pendingInvitations: 2, groups: 2 },
    });
  });

  it("marks an expired invitation and leaves it out of the pending count", async () => {
    const database = await open();
    const { classId, owner } = await classWithPeople(database);
    await createInvitations(
      database,
      owner,
      { classId, role: "student", emails: ["p@example.test"] },
      NOW,
    );
    const page = await getAdminClass(database, ADMIN, classId, new Date(NOW.getTime() + 31 * DAY));
    expect(page?.invitations).toEqual([expect.objectContaining({ expired: true })]);
    expect(page?.counts.pendingInvitations).toBe(0);
  });

  it("returns null for a class that does not exist or a malformed id", async () => {
    const database = await open();
    expect(
      await getAdminClass(database, ADMIN, "01960000-0000-7000-8000-00000000dead", NOW),
    ).toBeNull();
    expect(await getAdminClass(database, ADMIN, "../etc", NOW)).toBeNull();
  });
});

describe("searchTeacherCandidates (#37)", () => {
  it("lists the users whose app role includes teacher, by name", async () => {
    const database = await open();
    const zed = await person(database, "zed", ["teacher"], { name: "Zed Teacher" });
    const coordinator = await person(database, "coord", ["teacher", "admin"], {
      name: "Coordinator Test",
    });
    await person(database, "student", ["student"]);
    await person(database, "admin", ["admin"]);
    const classId = await newClass(database, zed, "LS-1A", "2026-2027");
    await join(database, classId, coordinator.id, "teacher");
    expect(await searchTeacherCandidates(database, ADMIN, { q: "" }, NOW)).toEqual([
      { id: coordinator.id, name: "Coordinator Test", email: coordinator.email },
      { id: zed.id, name: "Zed Teacher", email: zed.email },
    ]);
  });

  it("searches the name and the e-mail address, LIKE wildcards as plain text", async () => {
    const database = await open();
    const zed = await person(database, "zed", ["teacher"], { name: "Zed Teacher" });
    await person(database, "yan", ["teacher"], { name: "Yan Teacher" });
    const byName = await searchTeacherCandidates(database, ADMIN, { q: " zed " }, NOW);
    expect(byName.map((row) => row.id)).toEqual([zed.id]);
    const byEmail = await searchTeacherCandidates(database, ADMIN, { q: "zed@example" }, NOW);
    expect(byEmail.map((row) => row.id)).toEqual([zed.id]);
    expect(await searchTeacherCandidates(database, ADMIN, { q: "%" }, NOW)).toEqual([]);
  });

  it("leaves out a blocked teacher, and offers one whose block has ended", async () => {
    const database = await open();
    const blocked = await person(database, "blocked", ["teacher"], { name: "Blocked Teacher" });
    const ended = await person(database, "ended", ["teacher"], { name: "Ended Teacher" });
    const later = await person(database, "later", ["teacher"], { name: "Later Teacher" });
    await database
      .updateTable("user")
      .set({ banned: true, banExpires: null })
      .where("id", "=", blocked.id)
      .execute();
    await database
      .updateTable("user")
      .set({ banned: true, banExpires: new Date(NOW.getTime() - DAY) })
      .where("id", "=", ended.id)
      .execute();
    await database
      .updateTable("user")
      .set({ banned: true, banExpires: new Date(NOW.getTime() + DAY) })
      .where("id", "=", later.id)
      .execute();
    const rows = await searchTeacherCandidates(database, ADMIN, { q: "" }, NOW);
    expect(rows.map((row) => row.id)).toEqual([ended.id]);
  });
});

describe("the administrator's reads refuse other roles (#37, R-01)", () => {
  it.each([
    ["a student", ["student"]],
    ["a teacher", ["teacher"]],
  ] as const)("refuses %s every read with 403", async (_who, roles) => {
    const database = await open();
    const { classId } = await classWithPeople(database);
    const viewer = { roles };
    await expect(listAdminClassPage(database, viewer, {}, NOW)).rejects.toThrow(AuthError);
    await expect(getAdminClass(database, viewer, classId, NOW)).rejects.toThrow(AuthError);
    await expect(searchTeacherCandidates(database, viewer, { q: "" }, NOW)).rejects.toThrow(
      AuthError,
    );
  });

  it("lets a teacher-administrator read as an administrator", async () => {
    const database = await open();
    await classWithPeople(database);
    const page = await listAdminClassPage(database, { roles: ["teacher", "admin"] }, {}, NOW);
    expect(page.total).toBe(1);
  });
});

describe("the owner-not-teacher filter (#37)", () => {
  it("finds a class whose owner lost the teacher role, and one without an owner", async () => {
    const database = await open();
    const { a1, a2, b1, ada } = await fourClasses(database);
    await database.updateTable("user").set({ role: "admin" }).where("id", "=", ada.id).execute();
    await database
      .deleteFrom("member")
      .where("organizationId", "=", b1)
      .where("role", "=", "owner")
      .execute();
    const page = await listAdminClassPage(
      database,
      ADMIN,
      { ownerNotTeacher: true, status: ["active", "archived"] },
      NOW,
    );
    expect(page.rows.map((row) => row.id)).toEqual([a1, b1, a2]);
    const active = await listAdminClassPage(database, ADMIN, { status: ["active"] }, NOW);
    expect(active.facets.ownerNotTeacher).toBe(3);
    const none = await listAdminClassPage(database, ADMIN, { status: ["archived"] }, NOW);
    expect(none.facets.ownerNotTeacher).toBe(0);
  });

  it("counts no class while every owner is a teacher", async () => {
    const database = await open();
    await fourClasses(database);
    const page = await listAdminClassPage(database, ADMIN, { ownerNotTeacher: true }, NOW);
    expect(page.total).toBe(0);
    expect(page.facets.ownerNotTeacher).toBe(0);
  });
});
