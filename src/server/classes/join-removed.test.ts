// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// A student a teacher removed from a class (#49, owner decisions on the reviews of #119): they
// cannot rejoin with the live code, and their pending invitations to the class are revoked.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { acceptInvitationsOnSignIn } from "./acceptance.ts";
import { adminArchiveClass, adminImportStudents, adminTransferOwnership } from "./admin.ts";
import { removeMember } from "./classes.ts";
import { createInvitations } from "./invitations.ts";
import { joinClassWithCode } from "./join.ts";
import { auditRows, NOW, person } from "./test-helpers.ts";
import { classWithCode, context, memberRole } from "./test-join.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function open(): Promise<Kysely<DB>> {
  db = await createTestDb();
  return db;
}

describe("joinClassWithCode: a removed student (owner decision on the review of #119)", () => {
  it("cannot rejoin with the live code, and the log says why", async () => {
    const database = await open();
    const { classId, code, owner, studentA } = await classWithCode(database);
    await removeMember(database, owner, { classId, userId: studentA.id });
    expect(await joinClassWithCode(database, studentA, { code }, context())).toEqual({
      ok: false,
      error: "invalid_code",
    });
    expect(await memberRole(database, classId, studentA.id)).toBeNull();
    expect(await auditRows(database, "class_join_failed")).toEqual([
      expect.objectContaining({ reason_code: "removed", target_id: classId }),
    ]);
  });

  it("can join again once a teacher invites their address anew", async () => {
    const database = await open();
    const { classId, code, owner, studentA } = await classWithCode(database);
    await removeMember(database, owner, { classId, userId: studentA.id });
    await createInvitations(
      database,
      owner,
      { classId, role: "student", emails: [studentA.email] },
      NOW,
    );
    expect((await joinClassWithCode(database, studentA, { code }, context())).ok).toBe(true);
  });

  it("does not block another student", async () => {
    const database = await open();
    const { classId, code, owner, studentA } = await classWithCode(database);
    await removeMember(database, owner, { classId, userId: studentA.id });
    const newcomer = await person(database, "newcomer", ["student"]);
    expect((await joinClassWithCode(database, newcomer, { code }, context())).ok).toBe(true);
    const removals = await database.selectFrom("class_removals").select("user_id").execute();
    expect(removals).toEqual([{ user_id: studentA.id }]);
  });

  it("records no removal for a co-teacher", async () => {
    const database = await open();
    const { classId, owner, coTeacher } = await classWithCode(database);
    await removeMember(database, owner, { classId, userId: coTeacher.id });
    expect(await database.selectFrom("class_removals").select("user_id").execute()).toEqual([]);
  });
});

describe("removeMember revokes the removed student's pending invitations (owner decision)", () => {
  it("cancels the pending invitation in the same transaction, so sign-in does not undo it", async () => {
    const database = await open();
    const { classId, code, owner } = await classWithCode(database);
    const joiner = await person(database, "joiner", ["student"]);
    await createInvitations(
      database,
      owner,
      { classId, role: "student", emails: [joiner.email] },
      NOW,
    );
    // The student joins with the code before accepting, so the invitation is still pending.
    expect((await joinClassWithCode(database, joiner, { code }, context())).ok).toBe(true);
    await removeMember(database, owner, { classId, userId: joiner.id });

    const invitations = await database
      .selectFrom("invitation")
      .select(["id", "status", "ended_at"])
      .where("organizationId", "=", classId)
      .where("email", "=", joiner.email)
      .execute();
    expect(invitations).toEqual([
      { id: expect.any(String), status: "canceled", ended_at: expect.any(Date) },
    ]);
    expect(await auditRows(database, "invitation_revoked")).toEqual([
      expect.objectContaining({
        actor_id: owner.id,
        outcome: "success",
        target_type: "invitation",
        target_id: invitations[0]?.id,
        reason_code: "removed",
        metadata: { class_id: classId, class_role: "student" },
      }),
    ]);
    expect(await acceptInvitationsOnSignIn(database, joiner.id, NOW)).toEqual(
      expect.objectContaining({ accepted: 0 }),
    );
    expect(await memberRole(database, classId, joiner.id)).toBeNull();
  });

  it("leaves another address's invitation pending", async () => {
    const database = await open();
    const { classId, owner, studentA } = await classWithCode(database);
    await createInvitations(
      database,
      owner,
      { classId, role: "student", emails: ["someone-else@example.test"] },
      NOW,
    );
    await removeMember(database, owner, { classId, userId: studentA.id });
    const pending = await database
      .selectFrom("invitation")
      .select("status")
      .where("organizationId", "=", classId)
      .execute();
    expect(pending).toEqual([{ status: "pending" }]);
  });
});

describe("the join code beside the administrator's class actions (#37, #49)", () => {
  it("lets a removed student back in when an administrator imports their address", async () => {
    const database = await open();
    const { classId, code, owner, studentA } = await classWithCode(database);
    const admin = await person(database, "admin", ["admin"]);
    await removeMember(database, owner, { classId, userId: studentA.id });
    const imported = await adminImportStudents(
      database,
      admin,
      { classId, emails: [studentA.email] },
      NOW,
    );
    expect(imported.ok).toBe(true);
    expect((await joinClassWithCode(database, studentA, { code }, context())).ok).toBe(true);
  });

  it("keeps the code working when an administrator transfers the class", async () => {
    const database = await open();
    const { classId, code, coTeacher } = await classWithCode(database);
    const admin = await person(database, "admin", ["admin"]);
    expect(
      await adminTransferOwnership(database, admin, { classId, userId: coTeacher.id }, NOW),
    ).toEqual({ ok: true, value: null });
    const newcomer = await person(database, "newcomer", ["student"]);
    expect((await joinClassWithCode(database, newcomer, { code }, context())).ok).toBe(true);
    expect(await database.selectFrom("class_removals").select("user_id").execute()).toEqual([]);
  });

  it("refuses the code once an administrator archives the class", async () => {
    const database = await open();
    const { classId, code } = await classWithCode(database);
    const admin = await person(database, "admin", ["admin"]);
    expect((await adminArchiveClass(database, admin, { classId }, NOW)).ok).toBe(true);
    const newcomer = await person(database, "newcomer", ["student"]);
    expect(await joinClassWithCode(database, newcomer, { code }, context())).toEqual({
      ok: false,
      error: "invalid_code",
    });
  });
});
