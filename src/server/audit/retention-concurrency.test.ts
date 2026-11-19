// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The prune of waiting addresses beside a teacher's delete of a simulation, on a committed
// database (#311): the prune skips the rows the open delete holds and never waits on it.
import { afterEach, describe, expect, it } from "vitest";
import { type CommittedTestDb, createCommittedTestDb } from "../db/test-committed-db.ts";
import { world } from "../simulations/test-helpers.ts";
import { pruneRetention, WAITING_ADDRESS_RETENTION_DAYS } from "./retention.ts";

let committed: CommittedTestDb | undefined;

afterEach(async () => {
  await committed?.destroy();
  committed = undefined;
});

const NOW = new Date("2026-11-11T03:00:00Z");
const DAY_MS = 86_400_000;

describe("pruneRetention beside a simulation delete (#311)", () => {
  it("skips the rows an open delete holds, and deletes them at the next run", async () => {
    committed = await createCommittedTestDb(4);
    const { db } = committed;
    const w = await world(db);
    const old = new Date(NOW.getTime() - (WAITING_ADDRESS_RETENTION_DAYS + 10) * DAY_MS);
    await db
      .insertInto("lab_member_emails")
      .values([
        { simulation_id: w.simulationId, lab_id: w.labId, email: "a1@example.test", added_at: old },
        { simulation_id: w.simulationId, lab_id: w.labId, email: "a2@example.test", added_at: old },
        {
          simulation_id: w.outsideSimulationId,
          lab_id: w.outsideLabId,
          email: "b1@example.test",
          added_at: old,
        },
      ])
      .execute();
    const during = await db.transaction().execute(async (trx) => {
      await trx
        .deleteFrom("lab_member_emails")
        .where("simulation_id", "=", w.outsideSimulationId)
        .execute();
      await trx.deleteFrom("simulations").where("id", "=", w.outsideSimulationId).execute();
      return pruneRetention(db, NOW);
    });
    expect(during.waitingAddresses).toBe(2);
    const left = await db.selectFrom("lab_member_emails").select("email").execute();
    expect(left).toEqual([]);
    expect((await pruneRetention(db, NOW)).waitingAddresses).toBe(0);
  });

  it("deletes a row an open transaction holds once that transaction has ended", async () => {
    committed = await createCommittedTestDb(4);
    const { db } = committed;
    const w = await world(db);
    const old = new Date(NOW.getTime() - (WAITING_ADDRESS_RETENTION_DAYS + 10) * DAY_MS);
    await db
      .insertInto("lab_member_emails")
      .values({
        simulation_id: w.simulationId,
        lab_id: w.labId,
        email: "c1@example.test",
        added_at: old,
      })
      .execute();
    const during = await db.transaction().execute(async (trx) => {
      await trx
        .selectFrom("lab_member_emails")
        .select("email")
        .where("simulation_id", "=", w.simulationId)
        .forUpdate()
        .execute();
      return pruneRetention(db, NOW);
    });
    expect(during.waitingAddresses).toBe(0);
    expect((await pruneRetention(db, NOW)).waitingAddresses).toBe(1);
  });
});
