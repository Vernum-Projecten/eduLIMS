// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The link and a removed student (S10, R-01, B4, #330): a teacher's removal wins over a waiting
// address. The link refuses the student, logs the refusal with the reason `removed` once per
// removal, and leaves the address waiting for the classmate who may own it. Only a teacher adding
// the address again lets the student back.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { addEmails } from "./emails.ts";
import { joinLabWithCode } from "./join.ts";
import { linkWaitingAddresses } from "./linking.ts";
import { NOW, person } from "./test-helpers.ts";
import { context, labOf } from "./test-join.ts";
import {
  LATER,
  removals,
  removalWorld,
  remove,
  removedRefusals,
  removedWhileWaiting,
  verify,
  wait,
  waiting,
} from "./test-removal.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function open() {
  db = await createTestDb();
  return removalWorld(db);
}

const REFUSED_ONCE = { linked: 0, refused: 1, failed: 0 };

describe("a removed student and a waiting address the removal kept (#330 point 2)", () => {
  it("links nothing once verified, logs the refusal and keeps the removal and the row", async () => {
    const opened = await open();
    const { database, w } = opened;
    const student = await removedWhileWaiting(opened, "late-verified");
    await verify(database, student.id);
    expect(await linkWaitingAddresses(database, student.id, NOW)).toEqual(REFUSED_ONCE);
    expect(await labOf(database, w.simulationId, student.id)).toBeNull();
    expect(await removals(database, w.simulationId)).toEqual([{ user_id: student.id }]);
    expect(await waiting(database, student.email)).toEqual([
      { simulation_id: w.simulationId, lab_id: w.otherLabId },
    ]);
    expect(await removedRefusals(database)).toEqual([
      {
        actor_id: student.id,
        outcome: "refused",
        target_type: "lab",
        target_id: w.otherLabId,
        reason_code: "removed",
        metadata: { simulation_id: w.simulationId, user_id: student.id, join_via: "email" },
      },
    ]);
  });

  it("answers the code with invalid_code after the refusal", async () => {
    const opened = await open();
    const { database, w } = opened;
    const student = await removedWhileWaiting(opened, "late-verified");
    await verify(database, student.id);
    await linkWaitingAddresses(database, student.id, NOW);
    expect(await joinLabWithCode(database, student, { code: w.code }, context())).toEqual({
      ok: false,
      error: "invalid_code",
    });
    expect(await labOf(database, w.simulationId, student.id)).toBeNull();
  });

  it("still links the classmate who owns the address, through the same row", async () => {
    const opened = await open();
    const { database, w } = opened;
    const impostor = await removedWhileWaiting(opened, "classmate");
    await database
      .updateTable("user")
      .set({ email: "impostor@example.test" })
      .where("id", "=", impostor.id)
      .execute();
    const classmate = await person(database, "classmate", ["student"]);
    expect(await linkWaitingAddresses(database, classmate.id, NOW)).toEqual({
      linked: 1,
      refused: 0,
      failed: 0,
    });
    expect(await labOf(database, w.simulationId, classmate.id)).toEqual(
      expect.objectContaining({ lab_id: w.otherLabId, joined_via: "email" }),
    );
    expect(await removals(database, w.simulationId)).toEqual([{ user_id: impostor.id }]);
  });

  it("links the student once a teacher adds the address again", async () => {
    const opened = await open();
    const { database, w } = opened;
    const student = await removedWhileWaiting(opened, "re-added");
    await database.deleteFrom("lab_member_emails").where("email", "=", student.email).execute();
    await verify(database, student.id);
    const added = await addEmails(
      database,
      w.teacher,
      { labId: w.third, emails: [student.email] },
      NOW,
    );
    expect(added.ok && added.value.added).toBe(1);
    expect(await removals(database, w.simulationId)).toEqual([]);
    expect(await linkWaitingAddresses(database, student.id, NOW)).toEqual({
      linked: 1,
      refused: 0,
      failed: 0,
    });
    expect(await labOf(database, w.simulationId, student.id)).toEqual(
      expect.objectContaining({ lab_id: w.third }),
    );
  });
});

describe("the removed refusal is logged once per removal (#330)", () => {
  it("two sign-ins after a removal write one row, and both count the refusal", async () => {
    const opened = await open();
    const { database } = opened;
    const student = await removedWhileWaiting(opened, "twice");
    await verify(database, student.id);
    expect(await linkWaitingAddresses(database, student.id, NOW)).toEqual(REFUSED_ONCE);
    expect(await linkWaitingAddresses(database, student.id, LATER)).toEqual(REFUSED_ONCE);
    expect(await removedRefusals(database)).toHaveLength(1);
  });

  it("writes one row when the link's time predates the removal (review S2)", async () => {
    const opened = await open();
    const { database } = opened;
    const student = await removedWhileWaiting(opened, "early-clock");
    await verify(database, student.id);
    const earlier = new Date(NOW.getTime() - 1000);
    expect(await linkWaitingAddresses(database, student.id, earlier)).toEqual(REFUSED_ONCE);
    expect(await linkWaitingAddresses(database, student.id, earlier)).toEqual(REFUSED_ONCE);
    expect(await removedRefusals(database)).toHaveLength(1);
  });

  it("a new removal after the address was added again gives the next sign-in a new row", async () => {
    const opened = await open();
    const { database, w } = opened;
    const student = await removedWhileWaiting(opened, "again");
    await verify(database, student.id);
    await linkWaitingAddresses(database, student.id, NOW);
    await database.deleteFrom("lab_member_emails").where("email", "=", student.email).execute();
    const added = await addEmails(
      database,
      w.teacher,
      { labId: w.third, emails: [student.email] },
      NOW,
    );
    expect(added.ok && added.value.added).toBe(1);
    expect((await linkWaitingAddresses(database, student.id, NOW)).linked).toBe(1);
    expect(await remove(opened, student.id, LATER)).toEqual({ ok: true, value: null });
    // An address that waits for the account after the second removal, as point 3 of #330 has it.
    await wait(database, w.simulationId, w.otherLabId, student.email);
    expect(await linkWaitingAddresses(database, student.id, LATER)).toEqual(REFUSED_ONCE);
    expect(await removedRefusals(database)).toHaveLength(2);
  });
});
