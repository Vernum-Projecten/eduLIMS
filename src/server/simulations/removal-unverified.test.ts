// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// A removal or a move and the waiting addresses of an account whose email is unverified (S10,
// R-01, B4, #330): such an email may be a classmate's, so only a row of the lab the student leaves
// goes; a verified email drops its row anywhere in the simulation (#323). An address waits in at
// most one lab per simulation (`lab_member_emails_pk`). The removal and move log rows carry how
// many went (0 or 1). The link refuses a removed student and leaves the row waiting.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { addEmails } from "./emails.ts";
import { joinLabWithCode } from "./join.ts";
import { linkWaitingAddresses } from "./linking.ts";
import { moveMember, removeMember } from "./members.ts";
import { auditRows, NOW, type Person, person } from "./test-helpers.ts";
import { context, emptyLab, labOf, worldWithCode } from "./test-join.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function open() {
  db = await createTestDb();
  const w = await worldWithCode(db);
  const third = await emptyLab(db, w.simulationId, "Third Lab");
  return { database: db, w: { ...w, third } };
}

type Opened = Awaited<ReturnType<typeof open>>;

const CLASSMATE = "classmate@example.test";

async function waiting(database: Kysely<DB>, email: string) {
  return database
    .selectFrom("lab_member_emails")
    .select(["simulation_id", "lab_id"])
    .where("email", "=", email)
    .orderBy("lab_id")
    .execute();
}

async function wait(database: Kysely<DB>, simulationId: string, labId: string, email: string) {
  await database
    .insertInto("lab_member_emails")
    .values({ simulation_id: simulationId, lab_id: labId, email })
    .execute();
}

/** An unverified account that claims the address of a classmate who has no account yet. */
async function impostorInLab({ database, w }: Opened): Promise<Person> {
  const impostor = await person(database, "classmate", ["student"], { verified: false });
  expect(await joinLabWithCode(database, impostor, { code: w.code }, context())).toEqual({
    ok: true,
    value: expect.objectContaining({ status: "joined", labId: w.labId }),
  });
  return impostor;
}

function remove({ database, w }: Opened, userId: string) {
  return removeMember(database, w.teacher, { simulationId: w.simulationId, userId }, NOW);
}

function move({ database, w }: Opened, userId: string, labId: string) {
  return moveMember(database, w.teacher, { simulationId: w.simulationId, userId, labId });
}

async function logged(database: Kysely<DB>, action: "lab_member_removed" | "lab_member_moved") {
  const rows = await auditRows(database, action);
  return rows.map((row) => row.metadata);
}

describe("an unverified account leaves a lab (#330, R-01, B4)", () => {
  it("a removal keeps the classmate's address waiting in another lab, logged with count 0", async () => {
    const opened = await open();
    const { database, w } = opened;
    await wait(database, w.simulationId, w.otherLabId, CLASSMATE);
    const impostor = await impostorInLab(opened);
    expect(await remove(opened, impostor.id)).toEqual({ ok: true, value: null });
    expect(await waiting(database, CLASSMATE)).toEqual([
      { simulation_id: w.simulationId, lab_id: w.otherLabId },
    ]);
    expect(await logged(database, "lab_member_removed")).toEqual([
      { simulation_id: w.simulationId, user_id: impostor.id, count: 0 },
    ]);
  });

  it("a removal drops the address waiting in the lab the student leaves, with count 1", async () => {
    const opened = await open();
    const { database, w } = opened;
    const impostor = await impostorInLab(opened);
    await wait(database, w.simulationId, w.labId, impostor.email);
    await remove(opened, impostor.id);
    expect(await waiting(database, impostor.email)).toEqual([]);
    expect(await logged(database, "lab_member_removed")).toEqual([
      { simulation_id: w.simulationId, user_id: impostor.id, count: 1 },
    ]);
  });

  it("a move drops the address waiting in the lab left, logged with count 1", async () => {
    const opened = await open();
    const { database, w } = opened;
    const impostor = await impostorInLab(opened);
    await wait(database, w.simulationId, w.labId, impostor.email);
    expect(await move(opened, impostor.id, w.otherLabId)).toEqual({ ok: true, value: null });
    expect(await waiting(database, impostor.email)).toEqual([]);
    expect(await logged(database, "lab_member_moved")).toEqual([
      {
        simulation_id: w.simulationId,
        user_id: impostor.id,
        previous_lab_id: w.labId,
        count: 1,
      },
    ]);
  });

  it("a move keeps the classmate's address waiting in a third lab, logged with count 0", async () => {
    const opened = await open();
    const { database, w } = opened;
    await wait(database, w.simulationId, w.third, CLASSMATE);
    const impostor = await impostorInLab(opened);
    await move(opened, impostor.id, w.otherLabId);
    expect(await waiting(database, CLASSMATE)).toEqual([
      { simulation_id: w.simulationId, lab_id: w.third },
    ]);
    expect(await logged(database, "lab_member_moved")).toEqual([
      expect.objectContaining({ user_id: impostor.id, count: 0 }),
    ]);
  });

  it("a move keeps the classmate's address waiting in the target lab", async () => {
    const opened = await open();
    const { database, w } = opened;
    await wait(database, w.simulationId, w.otherLabId, CLASSMATE);
    const impostor = await impostorInLab(opened);
    await move(opened, impostor.id, w.otherLabId);
    expect(await waiting(database, CLASSMATE)).toHaveLength(1);
  });
});

describe("a verified account leaves a lab (#323, #330)", () => {
  it("a removal drops their address waiting in another lab of the simulation, with count 1", async () => {
    const opened = await open();
    const { database, w } = opened;
    await wait(database, w.simulationId, w.third, w.student.email);
    await wait(database, w.outsideSimulationId, w.outsideLabId, w.student.email);
    await remove(opened, w.student.id);
    expect(await waiting(database, w.student.email)).toEqual([
      { simulation_id: w.outsideSimulationId, lab_id: w.outsideLabId },
    ]);
    expect(await logged(database, "lab_member_removed")).toEqual([
      { simulation_id: w.simulationId, user_id: w.student.id, count: 1 },
    ]);
  });

  it("a move drops their address waiting in a third lab, logged with count 1", async () => {
    const opened = await open();
    const { database, w } = opened;
    await wait(database, w.simulationId, w.third, w.student.email);
    await move(opened, w.student.id, w.otherLabId);
    expect(await waiting(database, w.student.email)).toEqual([]);
    expect(await logged(database, "lab_member_moved")).toEqual([
      expect.objectContaining({ user_id: w.student.id, count: 1 }),
    ]);
  });
});

async function removals(database: Kysely<DB>, simulationId: string) {
  return database
    .selectFrom("simulation_removals")
    .select("user_id")
    .where("simulation_id", "=", simulationId)
    .execute();
}

/** Point 2 of #330: an unverified student joins lab A while their address waits in lab B. */
async function removedWhileWaiting(opened: Opened, key: string): Promise<Person> {
  const { database, w } = opened;
  const student = await person(database, key, ["student"], { verified: false });
  await wait(database, w.simulationId, w.otherLabId, student.email);
  expect((await joinLabWithCode(database, student, { code: w.code }, context())).ok).toBe(true);
  expect(await remove(opened, student.id)).toEqual({ ok: true, value: null });
  return student;
}

describe("a removed student and a waiting address the removal kept (#330)", () => {
  it("links nothing once verified, logs the refusal and keeps the removal and the row", async () => {
    const opened = await open();
    const { database, w } = opened;
    const student = await removedWhileWaiting(opened, "late-verified");
    await database
      .updateTable("user")
      .set({ emailVerified: true })
      .where("id", "=", student.id)
      .execute();
    expect(await linkWaitingAddresses(database, student.id, NOW)).toEqual({
      linked: 0,
      refused: 1,
      failed: 0,
    });
    expect(await labOf(database, w.simulationId, student.id)).toBeNull();
    expect(await removals(database, w.simulationId)).toEqual([{ user_id: student.id }]);
    expect(await waiting(database, student.email)).toEqual([
      { simulation_id: w.simulationId, lab_id: w.otherLabId },
    ]);
    const joined = await auditRows(database, "lab_member_joined");
    expect(joined.filter((row) => row.outcome === "refused")).toEqual([
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
    await database
      .updateTable("user")
      .set({ emailVerified: true })
      .where("id", "=", student.id)
      .execute();
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

const LATER = new Date(NOW.getTime() + 86_400_000);

async function verify(database: Kysely<DB>, userId: string) {
  await database
    .updateTable("user")
    .set({ emailVerified: true })
    .where("id", "=", userId)
    .execute();
}

async function removedRefusals(database: Kysely<DB>) {
  const rows = await auditRows(database, "lab_member_joined");
  return rows.filter((row) => row.reason_code === "removed");
}

describe("the removed refusal is logged once per removal (#330)", () => {
  it("two sign-ins after a removal write one row, and both count the refusal", async () => {
    const opened = await open();
    const { database } = opened;
    const student = await removedWhileWaiting(opened, "twice");
    await verify(database, student.id);
    const refusedOnce = { linked: 0, refused: 1, failed: 0 };
    expect(await linkWaitingAddresses(database, student.id, NOW)).toEqual(refusedOnce);
    expect(await linkWaitingAddresses(database, student.id, LATER)).toEqual(refusedOnce);
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
    const removed = await removeMember(
      database,
      w.teacher,
      { simulationId: w.simulationId, userId: student.id },
      LATER,
    );
    expect(removed).toEqual({ ok: true, value: null });
    // An address that waits for the account after the second removal, as point 3 of #330 has it.
    await wait(database, w.simulationId, w.otherLabId, student.email);
    expect(await linkWaitingAddresses(database, student.id, LATER)).toEqual({
      linked: 0,
      refused: 1,
      failed: 0,
    });
    expect(await removedRefusals(database)).toHaveLength(2);
  });
});
