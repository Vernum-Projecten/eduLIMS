// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// A student a teacher removed from a simulation (#288): they cannot rejoin with a lab's code until
// a teacher adds their address again, which clears the removal record; nothing else clears it.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { addEmails } from "./emails.ts";
import { joinLabWithCode } from "./join.ts";
import { linkWaitingAddresses } from "./linking.ts";
import { removeMember } from "./members.ts";
import { removeTeacher } from "./teachers.ts";
import { auditRows, NOW, person } from "./test-helpers.ts";
import { codeOf, context, labOf, worldWithCode } from "./test-join.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function open() {
  db = await createTestDb();
  const w = await worldWithCode(db);
  return { database: db, w };
}

async function removals(database: Kysely<DB>) {
  return database.selectFrom("simulation_removals").select("user_id").orderBy("user_id").execute();
}

describe("joinLabWithCode: a removed student (#288)", () => {
  it("cannot rejoin with the live code, and the log says why", async () => {
    const { database, w } = await open();
    await removeMember(
      database,
      w.teacher,
      { simulationId: w.simulationId, userId: w.student.id },
      NOW,
    );
    expect(await joinLabWithCode(database, w.student, { code: w.code }, context())).toEqual({
      ok: false,
      error: "invalid_code",
    });
    expect(await labOf(database, w.simulationId, w.student.id)).toBeNull();
    expect(await auditRows(database, "lab_join_failed")).toEqual([
      {
        actor_id: w.student.id,
        outcome: "failure",
        target_type: "lab",
        target_id: w.labId,
        reason_code: "removed",
        metadata: { simulation_id: w.simulationId },
      },
    ]);
  });

  it("cannot rejoin through the code of another lab of the simulation either", async () => {
    const { database, w } = await open();
    const other = await codeOf(database, w.teacher, w.otherLabId);
    await removeMember(
      database,
      w.teacher,
      { simulationId: w.simulationId, userId: w.student.id },
      NOW,
    );
    expect(await joinLabWithCode(database, w.student, { code: other }, context())).toEqual({
      ok: false,
      error: "invalid_code",
    });
  });

  it("can join again once a teacher adds their address anew", async () => {
    const { database, w } = await open();
    await removeMember(
      database,
      w.teacher,
      { simulationId: w.simulationId, userId: w.student.id },
      NOW,
    );
    const added = await addEmails(
      database,
      w.teacher,
      { labId: w.otherLabId, emails: [w.student.email] },
      NOW,
    );
    expect(added.ok).toBe(true);
    expect(await removals(database)).toEqual([]);
    expect((await joinLabWithCode(database, w.student, { code: w.code }, context())).ok).toBe(true);
  });

  it("can join again once a co-teacher adds their address (D10: same rights)", async () => {
    const { database, w } = await open();
    await removeMember(
      database,
      w.teacher,
      { simulationId: w.simulationId, userId: w.student.id },
      NOW,
    );
    await addEmails(database, w.coTeacher, { labId: w.labId, emails: [w.student.email] }, NOW);
    expect((await joinLabWithCode(database, w.student, { code: w.code }, context())).ok).toBe(true);
  });

  it("does not block another student", async () => {
    const { database, w } = await open();
    await removeMember(
      database,
      w.teacher,
      { simulationId: w.simulationId, userId: w.student.id },
      NOW,
    );
    expect((await joinLabWithCode(database, w.stranger, { code: w.code }, context())).ok).toBe(
      true,
    );
    expect(await removals(database)).toEqual([{ user_id: w.student.id }]);
  });

  it("does not block the student in another simulation", async () => {
    const { database, w } = await open();
    await removeMember(
      database,
      w.teacher,
      { simulationId: w.simulationId, userId: w.student.id },
      NOW,
    );
    const outside = await codeOf(database, w.outsiderTeacher, w.outsideLabId);
    expect((await joinLabWithCode(database, w.student, { code: outside }, context())).ok).toBe(
      true,
    );
  });

  it("is not undone by a later sign-in when no address waits for them", async () => {
    const { database, w } = await open();
    await removeMember(
      database,
      w.teacher,
      { simulationId: w.simulationId, userId: w.student.id },
      NOW,
    );
    expect(await linkWaitingAddresses(database, w.student.id, NOW)).toEqual({
      linked: 0,
      refused: 0,
      failed: 0,
    });
    expect(await labOf(database, w.simulationId, w.student.id)).toBeNull();
    expect((await joinLabWithCode(database, w.student, { code: w.code }, context())).ok).toBe(
      false,
    );
  });

  it("leaves another address waiting in the lab", async () => {
    const { database, w } = await open();
    await addEmails(database, w.teacher, { labId: w.labId, emails: ["waiting@example.test"] }, NOW);
    await removeMember(
      database,
      w.teacher,
      { simulationId: w.simulationId, userId: w.student.id },
      NOW,
    );
    const waiting = await database.selectFrom("lab_member_emails").select("email").execute();
    expect(waiting).toEqual([{ email: "waiting@example.test" }]);
  });
});

describe("the join code beside the teachers of a simulation (#288)", () => {
  it("records no removal when a teacher is removed", async () => {
    const { database, w } = await open();
    expect(
      await removeTeacher(database, w.teacher, {
        simulationId: w.simulationId,
        userId: w.coTeacher.id,
      }),
    ).toEqual({ ok: true, value: null });
    expect(await removals(database)).toEqual([]);
  });

  it("keeps a code working when the teacher who made it leaves the simulation", async () => {
    const { database, w } = await open();
    const code = await codeOf(database, w.coTeacher, w.otherLabId);
    await removeTeacher(database, w.teacher, {
      simulationId: w.simulationId,
      userId: w.coTeacher.id,
    });
    const newcomer = await person(database, "newcomer", ["student"]);
    expect((await joinLabWithCode(database, newcomer, { code }, context())).ok).toBe(true);
  });
});
