// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Parallel writes on a committed database (S10, #280): one lab per student per simulation and
// one waiting place per address per simulation hold under concurrent transactions, whether the
// service or a raw insert writes.
import { afterEach, describe, expect, it } from "vitest";
import { type CommittedTestDb, createCommittedTestDb } from "../db/test-committed-db.ts";
import { addEmails } from "./emails.ts";
import { createLab } from "./labs.ts";
import { linkWaitingAddresses } from "./linking.ts";
import { NOW, person, world } from "./test-helpers.ts";

let committed: CommittedTestDb | undefined;

afterEach(async () => {
  await committed?.destroy();
  committed = undefined;
});

async function open() {
  committed = await createCommittedTestDb(12);
  const { db } = committed;
  const w = await world(db);
  const labs = [w.labId, w.otherLabId];
  for (const name of ["Lab 3", "Lab 4", "Lab 5", "Lab 6"]) {
    const lab = await createLab(db, w.teacher, { simulationId: w.simulationId, name }, NOW);
    if (!lab.ok) throw new Error(lab.error);
    labs.push(lab.value.labId);
  }
  return { db, w, labs };
}

describe("parallel writes (S10, #280)", () => {
  it("lets one of ten parallel places of one student in one simulation through", async () => {
    const { db, w, labs } = await open();
    const newcomer = await person(db, "newcomer", ["student"]);
    const attempts = Array.from({ length: 10 }, (_, index) =>
      db
        .insertInto("lab_members")
        .values({
          simulation_id: w.simulationId,
          lab_id: labs[index % labs.length] ?? w.labId,
          user_id: newcomer.id,
          joined_via: "code",
        })
        .execute(),
    );
    const results = await Promise.allSettled(attempts);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const places = await db
      .selectFrom("lab_members")
      .select("lab_id")
      .where("user_id", "=", newcomer.id)
      .execute();
    expect(places).toHaveLength(1);
  });

  it("lets one of ten parallel waiting places of one address in one simulation through", async () => {
    const { db, w, labs } = await open();
    const attempts = Array.from({ length: 10 }, (_, index) =>
      db
        .insertInto("lab_member_emails")
        .values({
          simulation_id: w.simulationId,
          lab_id: labs[index % labs.length] ?? w.labId,
          email: "racer@example.test",
        })
        .execute(),
    );
    const results = await Promise.allSettled(attempts);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  });

  it("stores an address pasted into six labs at once in exactly one of them", async () => {
    const { db, w, labs } = await open();
    const results = await Promise.all(
      labs.map((labId) =>
        addEmails(db, w.teacher, { labId, emails: ["pasted@example.test"] }, NOW),
      ),
    );
    const added = results.map((result) => (result.ok ? result.value.added : -1));
    expect(added.filter((count) => count === 1)).toHaveLength(1);
    expect(added.filter((count) => count === 0)).toHaveLength(labs.length - 1);
    const rows = await db
      .selectFrom("lab_member_emails")
      .select("lab_id")
      .where("email", "=", "pasted@example.test")
      .execute();
    expect(rows).toHaveLength(1);
  });

  it("links a student once when two sign-ins run at the same time", async () => {
    const { db, w } = await open();
    const newcomer = await person(db, "newcomer", ["student"]);
    await addEmails(db, w.teacher, { labId: w.otherLabId, emails: [newcomer.email] }, NOW);
    const outcomes = await Promise.all([
      linkWaitingAddresses(db, newcomer.id, NOW),
      linkWaitingAddresses(db, newcomer.id, NOW),
      linkWaitingAddresses(db, newcomer.id, NOW),
    ]);
    expect(outcomes.reduce((sum, outcome) => sum + outcome.failed, 0)).toBe(0);
    const places = await db
      .selectFrom("lab_members")
      .select("lab_id")
      .where("user_id", "=", newcomer.id)
      .execute();
    expect(places).toEqual([{ lab_id: w.otherLabId }]);
    const joined = await db
      .selectFrom("audit_event")
      .select("outcome")
      .where("action", "=", "lab_member_joined")
      .where("actor_id", "=", newcomer.id)
      .execute();
    expect(joined).toEqual([{ outcome: "success" }]);
  });
});
