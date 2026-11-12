// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The administrator's class actions (#37, B2) against a real database: each one refuses a
// student and a teacher, never makes the administrator a member (R-01), and writes its
// activity-log row in the same transaction.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { newId } from "../db/ids.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { AuthError } from "../middleware.ts";
import type { ClassActor } from "./access.ts";
import {
  adminArchiveClass,
  adminCreateClass,
  adminImportStudents,
  adminPreviewImport,
  adminTransferOwnership,
  adminUnarchiveClass,
  isAppTeacher,
} from "./admin.ts";
import { archiveClass } from "./classes.ts";
import { createGroups, moveStudent } from "./groups.ts";
import { createInvitations } from "./invitations.ts";
import { auditRows, classWithPeople, NOW, person } from "./test-helpers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function open(): Promise<Kysely<DB>> {
  db = await createTestDb();
  return db;
}

const MISSING = "01960000-0000-7000-8000-00000000dead";

async function roleOf(database: Kysely<DB>, classId: string, userId: string) {
  const row = await database
    .selectFrom("member")
    .select("role")
    .where("organizationId", "=", classId)
    .where("userId", "=", userId)
    .executeTakeFirst();
  return row?.role ?? null;
}

async function archivedAt(database: Kysely<DB>, classId: string) {
  const row = await database
    .selectFrom("organization")
    .select("archived_at")
    .where("id", "=", classId)
    .executeTakeFirstOrThrow();
  return row.archived_at;
}

/** Blocks `userId` until `until`, or for good with `null`. */
async function block(database: Kysely<DB>, userId: string, until: Date | null): Promise<void> {
  await database
    .updateTable("user")
    .set({ banned: true, banExpires: until })
    .where("id", "=", userId)
    .execute();
}

/** A class with its people and an administrator who is no member of it. */
async function setup(database: Kysely<DB>) {
  const people = await classWithPeople(database);
  const admin = await person(database, "admin", ["admin"]);
  return { ...people, admin };
}

/** Every admin action, called by `actor` on `classId`. */
function everyAction(database: Kysely<DB>, actor: ClassActor, classId: string, userId: string) {
  return [
    adminArchiveClass(database, actor, { classId }, NOW),
    adminUnarchiveClass(database, actor, { classId }),
    adminTransferOwnership(database, actor, { classId, userId }, NOW),
    adminCreateClass(
      database,
      actor,
      { name: "LS-9Z", academicYear: "2026-2027", ownerId: userId },
      NOW,
    ),
    adminPreviewImport(database, actor, { classId, emails: ["x@example.test"] }, NOW),
    adminImportStudents(database, actor, { classId, emails: ["x@example.test"] }, NOW),
  ];
}

describe("the administrator's class actions refuse other roles (#37, R-01)", () => {
  it("refuses a student every action with 403", async () => {
    const database = await open();
    const { classId, studentA, outsider } = await setup(database);
    for (const call of everyAction(database, studentA, classId, outsider.id)) {
      await expect(call).rejects.toThrow(AuthError);
    }
  });

  it("refuses a teacher every action with 403, even the class owner", async () => {
    const database = await open();
    const { classId, owner, outsider } = await setup(database);
    for (const call of everyAction(database, owner, classId, outsider.id)) {
      await expect(call).rejects.toThrow(AuthError);
    }
    expect(await archivedAt(database, classId)).toBeNull();
    expect(await auditRows(database, "class_owner_changed")).toEqual([]);
  });

  it("answers not_found for a class that does not exist or a malformed id", async () => {
    const database = await open();
    const { admin } = await setup(database);
    for (const classId of [MISSING, "not-a-uuid"]) {
      expect(await adminArchiveClass(database, admin, { classId }, NOW)).toEqual({
        ok: false,
        error: "not_found",
      });
    }
  });
});

describe("adminArchiveClass and adminUnarchiveClass (#37)", () => {
  it("archives any class without making the administrator a member, and logs it", async () => {
    const database = await open();
    const { classId, admin } = await setup(database);
    expect(await adminArchiveClass(database, admin, { classId }, NOW)).toEqual({
      ok: true,
      value: null,
    });
    expect(await archivedAt(database, classId)).toEqual(NOW);
    expect(await roleOf(database, classId, admin.id)).toBeNull();
    expect(await auditRows(database, "class_archived")).toEqual([
      expect.objectContaining({ actor_id: admin.id, target_id: classId, outcome: "success" }),
    ]);
  });

  it("refuses to archive an archived class and logs the refusal", async () => {
    const database = await open();
    const { classId, owner, admin } = await setup(database);
    await archiveClass(database, owner, { classId }, NOW);
    expect(await adminArchiveClass(database, admin, { classId }, NOW)).toEqual({
      ok: false,
      error: "archived",
    });
    expect(await auditRows(database, "class_archived")).toEqual([
      expect.objectContaining({ actor_id: owner.id, outcome: "success" }),
      expect.objectContaining({ actor_id: admin.id, outcome: "refused", reason_code: "archived" }),
    ]);
  });

  it("reopens an archived class, and refuses one that is not archived", async () => {
    const database = await open();
    const { classId, admin } = await setup(database);
    expect(await adminUnarchiveClass(database, admin, { classId })).toEqual({
      ok: false,
      error: "not_archived",
    });
    await adminArchiveClass(database, admin, { classId }, NOW);
    expect(await adminUnarchiveClass(database, admin, { classId })).toEqual({
      ok: true,
      value: null,
    });
    expect(await archivedAt(database, classId)).toBeNull();
    expect(await auditRows(database, "class_unarchived")).toEqual([
      expect.objectContaining({ actor_id: admin.id, target_id: classId, outcome: "success" }),
    ]);
  });
});

describe("adminTransferOwnership (#37)", () => {
  it("makes a teacher outside the class its owner; the old owner stays as a co-teacher", async () => {
    const database = await open();
    const { classId, owner, outsider, admin } = await setup(database);
    const input = { classId, userId: outsider.id };
    expect(await adminTransferOwnership(database, admin, input, NOW)).toEqual({
      ok: true,
      value: null,
    });
    expect(await roleOf(database, classId, outsider.id)).toBe("owner");
    expect(await roleOf(database, classId, owner.id)).toBe("teacher");
    expect(await roleOf(database, classId, admin.id)).toBeNull();
    expect(await auditRows(database, "class_owner_changed")).toEqual([
      expect.objectContaining({
        actor_id: admin.id,
        target_id: classId,
        outcome: "success",
        metadata: { user_id: outsider.id, previous_user_id: owner.id },
      }),
    ]);
  });

  it("promotes a co-teacher, so the class keeps exactly one owner", async () => {
    const database = await open();
    const { classId, owner, coTeacher, admin } = await setup(database);
    await adminTransferOwnership(database, admin, { classId, userId: coTeacher.id }, NOW);
    const owners = await database
      .selectFrom("member")
      .select("userId")
      .where("organizationId", "=", classId)
      .where("role", "=", "owner")
      .execute();
    expect(owners).toEqual([{ userId: coTeacher.id }]);
    expect(await roleOf(database, classId, owner.id)).toBe("teacher");
  });

  it("removes an old owner who is no longer a teacher, with their lab-group places", async () => {
    const database = await open();
    const { classId, owner, studentA, outsider, admin } = await setup(database);
    const groups = await createGroups(
      database,
      owner,
      { classId, groupSet: "Pairs", names: ["Pair 1"] },
      NOW,
    );
    if (!groups.ok) throw new Error(groups.error);
    const team = await database
      .selectFrom("team")
      .select("id")
      .where("organizationId", "=", classId)
      .executeTakeFirstOrThrow();
    await moveStudent(
      database,
      owner,
      { classId, userId: studentA.id, groupSet: "Pairs", groupId: team.id },
      NOW,
    );
    await database
      .insertInto("teamMember")
      .values({ id: newId(), teamId: team.id, userId: owner.id, createdAt: NOW })
      .execute();
    await database.updateTable("user").set({ role: "admin" }).where("id", "=", owner.id).execute();
    await adminTransferOwnership(database, admin, { classId, userId: outsider.id }, NOW);
    expect(await roleOf(database, classId, owner.id)).toBeNull();
    const places = await database
      .selectFrom("teamMember")
      .select("userId")
      .where("teamId", "=", team.id)
      .execute();
    expect(places).toEqual([{ userId: studentA.id }]);
    const count = await database
      .selectFrom("team")
      .select("memberCount")
      .where("id", "=", team.id)
      .executeTakeFirstOrThrow();
    expect(Number(count.memberCount)).toBe(1);
  });

  it("refuses a new owner without the app role teacher and logs it", async () => {
    const database = await open();
    const { classId, studentA, admin } = await setup(database);
    for (const userId of [studentA.id, admin.id, "no-such-user"]) {
      expect(await adminTransferOwnership(database, admin, { classId, userId }, NOW)).toEqual({
        ok: false,
        error: "not_a_teacher",
      });
    }
    expect(await auditRows(database, "class_owner_changed")).toEqual([
      expect.objectContaining({ outcome: "refused", reason_code: "not_a_teacher" }),
      expect.objectContaining({ outcome: "refused", reason_code: "not_a_teacher" }),
      expect.objectContaining({ outcome: "refused", reason_code: "not_a_teacher" }),
    ]);
  });

  it("refuses a blocked teacher as the new owner and logs it, but not an ended block", async () => {
    const database = await open();
    const { classId, outsider, coTeacher, admin } = await setup(database);
    await block(database, outsider.id, null);
    expect(
      await adminTransferOwnership(database, admin, { classId, userId: outsider.id }, NOW),
    ).toEqual({ ok: false, error: "owner_blocked" });
    expect(await auditRows(database, "class_owner_changed")).toEqual([
      expect.objectContaining({ outcome: "refused", reason_code: "owner_blocked" }),
    ]);
    await block(database, coTeacher.id, new Date(NOW.getTime() - 1000));
    expect(
      await adminTransferOwnership(database, admin, { classId, userId: coTeacher.id }, NOW),
    ).toEqual({ ok: true, value: null });
  });

  it("refuses the current owner as the new owner", async () => {
    const database = await open();
    const { classId, owner, admin } = await setup(database);
    expect(
      await adminTransferOwnership(database, admin, { classId, userId: owner.id }, NOW),
    ).toEqual({ ok: false, error: "already_owner" });
  });

  it("refuses an archived class", async () => {
    const database = await open();
    const { classId, outsider, admin } = await setup(database);
    await adminArchiveClass(database, admin, { classId }, NOW);
    expect(
      await adminTransferOwnership(database, admin, { classId, userId: outsider.id }, NOW),
    ).toEqual({ ok: false, error: "archived" });
  });

  it("gives an ownerless class an owner", async () => {
    const database = await open();
    const { classId, owner, outsider, admin } = await setup(database);
    await database
      .deleteFrom("member")
      .where("organizationId", "=", classId)
      .where("userId", "=", owner.id)
      .execute();
    await adminTransferOwnership(database, admin, { classId, userId: outsider.id }, NOW);
    expect(await roleOf(database, classId, outsider.id)).toBe("owner");
    expect(await auditRows(database, "class_owner_changed")).toEqual([
      expect.objectContaining({ metadata: { user_id: outsider.id } }),
    ]);
  });
});

describe("adminCreateClass (#37, B2)", () => {
  it("creates a class owned by the chosen teacher; the administrator is no member", async () => {
    const database = await open();
    const admin = await person(database, "admin", ["admin"]);
    const teacher = await person(database, "t", ["teacher"]);
    const result = await adminCreateClass(
      database,
      admin,
      { name: " LS-3A ", academicYear: "2026-2027", ownerId: teacher.id },
      NOW,
    );
    if (!result.ok) throw new Error(result.error);
    const { classId } = result.value;
    const members = await database
      .selectFrom("member")
      .select(["userId", "role"])
      .where("organizationId", "=", classId)
      .execute();
    expect(members).toEqual([{ userId: teacher.id, role: "owner" }]);
    const row = await database
      .selectFrom("organization")
      .select(["name", "slug"])
      .where("id", "=", classId)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ name: "LS-3A", slug: classId });
    expect(await auditRows(database, "class_created")).toEqual([
      expect.objectContaining({
        actor_id: admin.id,
        target_id: classId,
        outcome: "success",
        metadata: { user_id: teacher.id },
      }),
    ]);
  });

  it("lets a teacher-administrator choose themselves as the owner", async () => {
    const database = await open();
    const coordinator = await person(database, "coordinator", ["teacher", "admin"]);
    const result = await adminCreateClass(
      database,
      coordinator,
      { name: "LS-3B", academicYear: "2026-2027", ownerId: coordinator.id },
      NOW,
    );
    expect(result.ok).toBe(true);
  });

  it("refuses a blocked owner, creates nothing and logs it", async () => {
    const database = await open();
    const admin = await person(database, "admin", ["admin"]);
    const teacher = await person(database, "t", ["teacher"]);
    await block(database, teacher.id, new Date(NOW.getTime() + 60_000));
    const result = await adminCreateClass(
      database,
      admin,
      { name: "LS-3D", academicYear: "2026-2027", ownerId: teacher.id },
      NOW,
    );
    expect(result).toEqual({ ok: false, error: "owner_blocked" });
    expect(await database.selectFrom("organization").select("id").execute()).toEqual([]);
    expect(await auditRows(database, "class_created")).toEqual([
      expect.objectContaining({ outcome: "refused", reason_code: "owner_blocked" }),
    ]);
  });

  it("refuses an owner without the app role teacher, creates nothing and logs it", async () => {
    const database = await open();
    const admin = await person(database, "admin", ["admin"]);
    const student = await person(database, "s", ["student"]);
    const result = await adminCreateClass(
      database,
      admin,
      { name: "LS-3C", academicYear: "2026-2027", ownerId: student.id },
      NOW,
    );
    expect(result).toEqual({ ok: false, error: "not_a_teacher" });
    expect(await database.selectFrom("organization").select("id").execute()).toEqual([]);
    expect(await auditRows(database, "class_created")).toEqual([
      expect.objectContaining({ actor_id: admin.id, outcome: "refused", target_id: null }),
    ]);
  });
});

describe("adminPreviewImport and adminImportStudents (#37, B2)", () => {
  const LIST = [
    "new@example.test",
    "not-an-address",
    "NEW@example.test",
    "student-a@example.test",
    "invited@example.test",
  ];

  it("previews invalid, duplicate, member and invited rows without creating anything", async () => {
    const database = await open();
    const { classId, owner, admin } = await setup(database);
    await createInvitations(
      database,
      owner,
      { classId, role: "student", emails: ["invited@example.test"] },
      NOW,
    );
    const result = await adminPreviewImport(database, admin, { classId, emails: LIST }, NOW);
    expect(result).toEqual({
      ok: true,
      value: [
        { email: "new@example.test", status: "new" },
        { email: "not-an-address", status: "invalid" },
        { email: "new@example.test", status: "duplicate" },
        { email: "student-a@example.test", status: "member" },
        { email: "invited@example.test", status: "invited" },
      ],
    });
    const invitations = await database.selectFrom("invitation").select("email").execute();
    expect(invitations).toEqual([{ email: "invited@example.test" }]);
  });

  it("creates pending student invitations for the new rows only, each logged", async () => {
    const database = await open();
    const { classId, admin } = await setup(database);
    const result = await adminImportStudents(database, admin, { classId, emails: LIST }, NOW);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.created).toBe(2);
    const rows = await database
      .selectFrom("invitation")
      .select(["email", "role", "status", "inviterId"])
      .where("organizationId", "=", classId)
      .orderBy("email")
      .execute();
    expect(rows).toEqual([
      { email: "invited@example.test", role: "student", status: "pending", inviterId: admin.id },
      { email: "new@example.test", role: "student", status: "pending", inviterId: admin.id },
    ]);
    expect(await roleOf(database, classId, admin.id)).toBeNull();
    const logged = await auditRows(database, "invitation_created");
    expect(logged).toHaveLength(2);
    expect(logged).toEqual(
      Array(2).fill(
        expect.objectContaining({
          actor_id: admin.id,
          outcome: "success",
          metadata: { class_id: classId, class_role: "student" },
        }),
      ),
    );
  });

  it("grants nobody membership: the students stay out until they sign in", async () => {
    const database = await open();
    const { classId, admin } = await setup(database);
    const existing = await person(database, "existing", ["student"]);
    await adminImportStudents(database, admin, { classId, emails: [existing.email] }, NOW);
    expect(await roleOf(database, classId, existing.id)).toBeNull();
  });

  it("keeps the invitations when their inviter is deleted (#37)", async () => {
    const database = await open();
    const { classId, owner, admin } = await setup(database);
    await adminImportStudents(database, admin, { classId, emails: ["a@example.test"] }, NOW);
    await createInvitations(
      database,
      owner,
      { classId, role: "student", emails: ["b@example.test"] },
      NOW,
    );
    await database.deleteFrom("user").where("id", "in", [admin.id, owner.id]).execute();
    const rows = await database
      .selectFrom("invitation")
      .select(["email", "status", "inviterId"])
      .where("organizationId", "=", classId)
      .orderBy("email")
      .execute();
    expect(rows).toEqual([
      { email: "a@example.test", status: "pending", inviterId: null },
      { email: "b@example.test", status: "pending", inviterId: null },
    ]);
  });

  it("refuses an archived class and logs the refusal under the class", async () => {
    const database = await open();
    const { classId, admin } = await setup(database);
    await adminArchiveClass(database, admin, { classId }, NOW);
    expect(await adminImportStudents(database, admin, { classId, emails: LIST }, NOW)).toEqual({
      ok: false,
      error: "archived",
    });
    expect(await adminPreviewImport(database, admin, { classId, emails: LIST }, NOW)).toEqual({
      ok: false,
      error: "archived",
    });
    expect(await auditRows(database, "invitation_created")).toEqual([
      expect.objectContaining({ outcome: "refused", metadata: { class_id: classId } }),
      expect.objectContaining({ outcome: "refused", metadata: { class_id: classId } }),
    ]);
  });
});

describe("isAppTeacher", () => {
  it("reads the app role teacher from a stored role value only", () => {
    expect(isAppTeacher("teacher")).toBe(true);
    expect(isAppTeacher("teacher,admin")).toBe(true);
    expect(isAppTeacher("admin")).toBe(false);
    expect(isAppTeacher("student")).toBe(false);
    expect(isAppTeacher("student,teacher")).toBe(false);
    expect(isAppTeacher(null)).toBe(false);
    expect(isAppTeacher(undefined)).toBe(false);
  });
});
