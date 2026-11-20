// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// A removal or a move and the waiting address of an account whose email is unverified (S10, R-01,
// B4, #330): such an email may be a classmate's, so it drops nothing; a verified email drops its
// row anywhere in the simulation (#323). An address waits in at most one lab per simulation
// (`lab_member_emails_pk`), so the removal and move log rows carry a count of 0 or 1. Adding an
// address clears only the removal of an account whose email is verified.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { addEmails } from "./emails.ts";
import { joinLabWithCode } from "./join.ts";
import { moveMember } from "./members.ts";
import { auditRows, NOW, type Person, person } from "./test-helpers.ts";
import { context } from "./test-join.ts";
import {
  CLASSMATE,
  type Opened,
  removals,
  removalWorld,
  remove,
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

/** An unverified account that claims the address of a classmate who has no account yet. */
async function impostorInLab({ database, w }: Opened, verified = false): Promise<Person> {
  const impostor = await person(database, "classmate", ["student"], { verified });
  expect(await joinLabWithCode(database, impostor, { code: w.code }, context())).toEqual({
    ok: true,
    value: expect.objectContaining({ status: "joined", labId: w.labId }),
  });
  return impostor;
}

function move({ database, w }: Opened, userId: string, labId: string) {
  return moveMember(database, w.teacher, { simulationId: w.simulationId, userId, labId });
}

async function logged(database: Kysely<DB>, action: "lab_member_removed" | "lab_member_moved") {
  const rows = await auditRows(database, action);
  return rows.map((row) => row.metadata);
}

describe("an unverified account leaves a lab: no waiting address goes (#330, R-01, B4)", () => {
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

  it("a removal keeps the address waiting in the lab the student leaves, with count 0", async () => {
    const opened = await open();
    const { database, w } = opened;
    const impostor = await impostorInLab(opened);
    await wait(database, w.simulationId, w.labId, CLASSMATE);
    await remove(opened, impostor.id);
    expect(await waiting(database, CLASSMATE)).toEqual([
      { simulation_id: w.simulationId, lab_id: w.labId },
    ]);
    expect(await logged(database, "lab_member_removed")).toEqual([
      { simulation_id: w.simulationId, user_id: impostor.id, count: 0 },
    ]);
  });

  it("a move keeps the address waiting in the lab left, logged with count 0", async () => {
    const opened = await open();
    const { database, w } = opened;
    const impostor = await impostorInLab(opened);
    await wait(database, w.simulationId, w.labId, CLASSMATE);
    expect(await move(opened, impostor.id, w.otherLabId)).toEqual({ ok: true, value: null });
    expect(await waiting(database, CLASSMATE)).toEqual([
      { simulation_id: w.simulationId, lab_id: w.labId },
    ]);
    expect(await logged(database, "lab_member_moved")).toEqual([
      {
        simulation_id: w.simulationId,
        user_id: impostor.id,
        previous_lab_id: w.labId,
        count: 0,
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
});

describe("a verified account leaves a lab: its waiting address goes (#323, #330)", () => {
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

  it("a move keeps their address waiting in its target lab, logged with count 0", async () => {
    const opened = await open();
    const { database, w } = opened;
    await wait(database, w.simulationId, w.otherLabId, w.student.email);
    await move(opened, w.student.id, w.otherLabId);
    expect(await waiting(database, w.student.email)).toEqual([
      { simulation_id: w.simulationId, lab_id: w.otherLabId },
    ]);
    expect(await logged(database, "lab_member_moved")).toEqual([
      expect.objectContaining({ user_id: w.student.id, count: 0 }),
    ]);
  });
});

describe("adding an address clears only a verified account's removal (#330 S1)", () => {
  async function removedThenAdded(verified: boolean) {
    const opened = await open();
    const { database, w } = opened;
    const account = await impostorInLab(opened, verified);
    expect(await remove(opened, account.id)).toEqual({ ok: true, value: null });
    const added = await addEmails(
      database,
      w.teacher,
      { labId: w.third, emails: [CLASSMATE] },
      NOW,
    );
    expect(added.ok && added.value.added).toBe(1);
    return { ...opened, account };
  }

  it("keeps an unverified impostor's removal: the code still answers invalid_code", async () => {
    const { database, w, account } = await removedThenAdded(false);
    expect(await removals(database, w.simulationId)).toEqual([{ user_id: account.id }]);
    expect(await joinLabWithCode(database, account, { code: w.code }, context())).toEqual({
      ok: false,
      error: "invalid_code",
    });
  });

  it("clears a verified account's removal, as a teacher adding them again", async () => {
    const { database, w } = await removedThenAdded(true);
    expect(await removals(database, w.simulationId)).toEqual([]);
  });
});
