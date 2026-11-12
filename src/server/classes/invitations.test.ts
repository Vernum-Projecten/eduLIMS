// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { AuthError } from "../middleware.ts";
import { acceptInvitationsOnSignIn, hasPendingStudentInvitation } from "./acceptance.ts";
import { archiveClass } from "./classes.ts";
import {
  cancelInvitation,
  createInvitations,
  invitationExpiry,
  inviteeFits,
  previewInvitations,
  resendInvitation,
} from "./invitations.ts";
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

const DAY = 86_400_000;

async function invitationsOf(database: Kysely<DB>, classId: string) {
  return database
    .selectFrom("invitation")
    .select(["id", "email", "role", "status", "expiresAt", "ended_at"])
    .where("organizationId", "=", classId)
    .orderBy("email")
    .execute();
}

async function memberRoleOf(database: Kysely<DB>, classId: string, userId: string) {
  const row = await database
    .selectFrom("member")
    .select("role")
    .where("organizationId", "=", classId)
    .where("userId", "=", userId)
    .executeTakeFirst();
  return row?.role ?? null;
}

describe("inviteeFits (#28: the app role decides the class role)", () => {
  it.each([
    ["student", undefined, true],
    ["student", "student", true],
    ["student", "teacher", false],
    ["student", "admin", false],
    ["teacher", undefined, false],
    ["teacher", "student", false],
    ["teacher", "teacher", true],
    ["teacher", "teacher,admin", true],
    ["teacher", "admin", false],
  ] as const)("%s with stored role %s gives %s", (role, stored, expected) => {
    expect(inviteeFits(role, stored)).toBe(expected);
  });
});

describe("previewInvitations", () => {
  it("reports invalid, duplicate, member, invited and wrong-role rows and creates nothing", async () => {
    const database = await open();
    const { classId, owner, studentA } = await classWithPeople(database);
    const teacher = await person(database, "other-teacher", ["teacher"]);
    await createInvitations(
      database,
      owner,
      { classId, role: "student", emails: ["old@example.test"] },
      NOW,
    );
    const result = await previewInvitations(
      database,
      owner,
      {
        classId,
        role: "student",
        emails: [
          "New@Example.test",
          "not-an-address",
          "new@example.test",
          studentA.email,
          "old@example.test",
          teacher.email,
        ],
      },
      NOW,
    );
    expect(result).toEqual({
      ok: true,
      value: [
        { email: "new@example.test", status: "new" },
        { email: "not-an-address", status: "invalid" },
        { email: "new@example.test", status: "duplicate" },
        { email: studentA.email, status: "member" },
        { email: "old@example.test", status: "invited" },
        // A student row never tells which accounts exist (security review of #28).
        { email: teacher.email, status: "new" },
      ],
    });
    expect(await invitationsOf(database, classId)).toHaveLength(1);
  });
});

describe("createInvitations", () => {
  it("creates only the new rows, each pending for 30 days and logged with ids (B4)", async () => {
    const database = await open();
    const { classId, coTeacher } = await classWithPeople(database);
    const result = await createInvitations(
      database,
      coTeacher,
      { classId, role: "student", emails: ["one@example.test", "bad", "two@example.test"] },
      NOW,
    );
    expect(result.ok && result.value.created).toBe(2);
    const rows = await invitationsOf(database, classId);
    expect(rows.map((row) => [row.email, row.role, row.status])).toEqual([
      ["one@example.test", "student", "pending"],
      ["two@example.test", "student", "pending"],
    ]);
    expect(rows[0]?.expiresAt).toEqual(new Date(NOW.getTime() + 30 * DAY));
    const logged = await auditRows(database, "invitation_created");
    expect(logged).toHaveLength(2);
    expect(logged[0]?.metadata).toEqual({ class_id: classId, class_role: "student" });
    expect(JSON.stringify(logged)).not.toContain("@example.test");
  });

  it("lets the owner invite a co-teacher whose app role includes teacher", async () => {
    const database = await open();
    const { classId, owner } = await classWithPeople(database);
    const colleague = await person(database, "colleague", ["teacher", "admin"]);
    const result = await createInvitations(
      database,
      owner,
      { classId, role: "teacher", emails: [colleague.email] },
      NOW,
    );
    expect(result.ok && result.value.created).toBe(1);
  });

  it("refuses a co-teacher invitation for a student or an unknown address alike (not_a_teacher)", async () => {
    const database = await open();
    const { classId, owner } = await classWithPeople(database);
    const student = await person(database, "outside-student", ["student"]);
    const result = await createInvitations(
      database,
      owner,
      { classId, role: "teacher", emails: [student.email, "nobody@example.test"] },
      NOW,
    );
    expect(result).toEqual({
      ok: true,
      value: {
        created: 0,
        rows: [
          { email: student.email, status: "not_a_teacher" },
          { email: "nobody@example.test", status: "not_a_teacher" },
        ],
      },
    });
  });

  it("never tells an administrator account from a missing one (V8.2.2)", async () => {
    const database = await open();
    const { classId, owner } = await classWithPeople(database);
    const admin = await person(database, "outside-admin", ["admin"]);
    for (const role of ["student", "teacher"] as const) {
      const preview = await previewInvitations(
        database,
        owner,
        { classId, role, emails: [admin.email, "nobody@example.test"] },
        NOW,
      );
      const statuses = preview.ok ? preview.value.map((row) => row.status) : [];
      expect(statuses).toHaveLength(2);
      expect(statuses[0]).toBe(statuses[1]);
    }
  });

  it("invites a teacher's address as a student, and acceptance skips it", async () => {
    const database = await open();
    const { classId, owner } = await classWithPeople(database);
    const teacher = await person(database, "outside-teacher", ["teacher"]);
    const result = await createInvitations(
      database,
      owner,
      { classId, role: "student", emails: [teacher.email] },
      NOW,
    );
    expect(result.ok && result.value.created).toBe(1);
    expect(await acceptInvitationsOnSignIn(database, teacher.id, NOW)).toEqual({
      accepted: 0,
      skipped: 1,
    });
    expect(await memberRoleOf(database, classId, teacher.id)).toBeNull();
  });

  it("refuses a co-teacher who invites a co-teacher (#28 (3): only the owner)", async () => {
    const database = await open();
    const { classId, coTeacher } = await classWithPeople(database);
    const colleague = await person(database, "colleague", ["teacher"]);
    expect(
      await createInvitations(
        database,
        coTeacher,
        { classId, role: "teacher", emails: [colleague.email] },
        NOW,
      ),
    ).toEqual({ ok: false, error: "forbidden" });
  });

  it("refuses an archived class", async () => {
    const database = await open();
    const { classId, owner } = await classWithPeople(database);
    await archiveClass(database, owner, { classId }, NOW);
    expect(
      await createInvitations(
        database,
        owner,
        { classId, role: "student", emails: ["a@example.test"] },
        NOW,
      ),
    ).toEqual({ ok: false, error: "archived" });
  });

  it("answers not_found to a teacher of another class and 403 to a student", async () => {
    const database = await open();
    const { classId, outsider, studentA } = await classWithPeople(database);
    const input = { classId, role: "student", emails: ["a@example.test"] } as const;
    expect(await createInvitations(database, outsider, input, NOW)).toEqual({
      ok: false,
      error: "not_found",
    });
    await expect(createInvitations(database, studentA, input, NOW)).rejects.toThrow(AuthError);
    await expect(previewInvitations(database, studentA, input, NOW)).rejects.toThrow(AuthError);
  });

  it("replaces an expired pending invitation with a fresh one", async () => {
    const database = await open();
    const { classId, owner } = await classWithPeople(database);
    const input = { classId, role: "student", emails: ["late@example.test"] } as const;
    await createInvitations(database, owner, input, NOW);
    const later = new Date(NOW.getTime() + 31 * DAY);
    const result = await createInvitations(database, owner, input, later);
    expect(result.ok && result.value.created).toBe(1);
    const rows = await invitationsOf(database, classId);
    expect(rows.map((row) => row.status).sort()).toEqual(["canceled", "pending"]);
  });
});

describe("resendInvitation and cancelInvitation", () => {
  async function invited(database: Kysely<DB>) {
    const people = await classWithPeople(database);
    await createInvitations(
      database,
      people.owner,
      { classId: people.classId, role: "student", emails: ["s@example.test"] },
      NOW,
    );
    const [row] = await invitationsOf(database, people.classId);
    if (!row) throw new Error("no invitation");
    return { ...people, invitationId: row.id };
  }

  it("resends an expired invitation with a new 30-day term", async () => {
    const database = await open();
    const { classId, coTeacher, invitationId } = await invited(database);
    const later = new Date(NOW.getTime() + 40 * DAY);
    expect(await resendInvitation(database, coTeacher, { classId, invitationId }, later)).toEqual({
      ok: true,
      value: null,
    });
    const [row] = await invitationsOf(database, classId);
    expect(row?.expiresAt).toEqual(invitationExpiry(later));
    expect(await auditRows(database, "invitation_resent")).toHaveLength(1);
  });

  it("cancels a pending invitation and stamps when it ended", async () => {
    const database = await open();
    const { classId, owner, invitationId } = await invited(database);
    expect(await cancelInvitation(database, owner, { classId, invitationId }, NOW)).toEqual({
      ok: true,
      value: null,
    });
    const [row] = await invitationsOf(database, classId);
    expect([row?.status, row?.ended_at]).toEqual(["canceled", NOW]);
    expect(await cancelInvitation(database, owner, { classId, invitationId }, NOW)).toEqual({
      ok: false,
      error: "invitation_not_found",
    });
    expect(await auditRows(database, "invitation_revoked")).toHaveLength(1);
  });

  it("refuses a co-teacher on a co-teacher invitation", async () => {
    const database = await open();
    const { classId, owner, coTeacher } = await classWithPeople(database);
    const colleague = await person(database, "colleague", ["teacher"]);
    await createInvitations(
      database,
      owner,
      { classId, role: "teacher", emails: [colleague.email] },
      NOW,
    );
    const [row] = await invitationsOf(database, classId);
    const input = { classId, invitationId: row?.id ?? "" };
    expect(await cancelInvitation(database, coTeacher, input, NOW)).toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("answers not_found to a teacher of another class", async () => {
    const database = await open();
    const { classId, outsider, invitationId } = await invited(database);
    expect(await resendInvitation(database, outsider, { classId, invitationId }, NOW)).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});

describe("acceptInvitationsOnSignIn (#28: no accept step)", () => {
  it("adds a verified student to every class that invited the address", async () => {
    const database = await open();
    const first = await classWithPeople(database);
    const joiner = await person(database, "joiner", ["student"]);
    await createInvitations(
      database,
      first.owner,
      { classId: first.classId, role: "student", emails: [joiner.email.toUpperCase()] },
      NOW,
    );
    expect(await acceptInvitationsOnSignIn(database, joiner.id, NOW)).toEqual({
      accepted: 1,
      skipped: 0,
    });
    expect(await memberRoleOf(database, first.classId, joiner.id)).toBe("student");
    const [row] = await invitationsOf(database, first.classId);
    expect([row?.status, row?.ended_at]).toEqual(["accepted", NOW]);
    expect(await auditRows(database, "invitation_accepted")).toEqual([
      expect.objectContaining({
        actor_id: joiner.id,
        metadata: { class_id: first.classId, class_role: "student" },
      }),
    ]);
  });

  it("accepts nothing for an unverified email", async () => {
    const database = await open();
    const { classId, owner } = await classWithPeople(database);
    const joiner = await person(database, "joiner", ["student"], { verified: false });
    await createInvitations(
      database,
      owner,
      { classId, role: "student", emails: [joiner.email] },
      NOW,
    );
    expect(await acceptInvitationsOnSignIn(database, joiner.id, NOW)).toEqual({
      accepted: 0,
      skipped: 0,
    });
    expect(await memberRoleOf(database, classId, joiner.id)).toBeNull();
  });

  it("leaves expired invitations and archived classes alone", async () => {
    const database = await open();
    const { classId, owner } = await classWithPeople(database);
    const joiner = await person(database, "joiner", ["student"]);
    await createInvitations(
      database,
      owner,
      { classId, role: "student", emails: [joiner.email] },
      NOW,
    );
    const later = new Date(NOW.getTime() + 31 * DAY);
    expect(await acceptInvitationsOnSignIn(database, joiner.id, later)).toEqual({
      accepted: 0,
      skipped: 0,
    });
    await archiveClass(database, owner, { classId }, NOW);
    expect(await acceptInvitationsOnSignIn(database, joiner.id, NOW)).toEqual({
      accepted: 0,
      skipped: 0,
    });
  });

  it("skips a co-teacher invitation for someone whose app role lost teacher", async () => {
    const database = await open();
    const { classId, owner } = await classWithPeople(database);
    const colleague = await person(database, "colleague", ["teacher"]);
    await createInvitations(
      database,
      owner,
      { classId, role: "teacher", emails: [colleague.email] },
      NOW,
    );
    await database
      .updateTable("user")
      .set({ role: "admin" })
      .where("id", "=", colleague.id)
      .execute();
    expect(await acceptInvitationsOnSignIn(database, colleague.id, NOW)).toEqual({
      accepted: 0,
      skipped: 1,
    });
  });
});

describe("hasPendingStudentInvitation (#28 (2))", () => {
  it("is true only for a pending, unexpired student invitation in an active class", async () => {
    const database = await open();
    const { classId, owner } = await classWithPeople(database);
    await createInvitations(
      database,
      owner,
      { classId, role: "student", emails: ["new@example.test"] },
      NOW,
    );
    expect(await hasPendingStudentInvitation(database, " NEW@example.test ", NOW)).toBe(true);
    expect(await hasPendingStudentInvitation(database, "other@example.test", NOW)).toBe(false);
    const later = new Date(NOW.getTime() + 31 * DAY);
    expect(await hasPendingStudentInvitation(database, "new@example.test", later)).toBe(false);
    await archiveClass(database, owner, { classId }, NOW);
    expect(await hasPendingStudentInvitation(database, "new@example.test", NOW)).toBe(false);
  });
});
