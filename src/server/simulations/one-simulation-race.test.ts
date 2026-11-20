// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// One simulation at a time per student under concurrency (#379): two joins of one student into
// two simulations at once, a join that meets a link, and two raw writes that meet in the trigger
// of migration 0026. These need real, committing transactions; the forced-order cases hold the
// first writer open by hand so the second is seen waiting on the student's lock.
import { describe, expect, it } from "vitest";
import { committedTestDbPerCase } from "../db/test-committed-hooks.ts";
import { settlesWithin } from "../db/test-lock-waiters.ts";
import { addEmails } from "./emails.ts";
import { type JoinContext, joinLabWithCode } from "./join.ts";
import { JOIN_LIMITS } from "./join-limits.ts";
import { linkWaitingAddresses } from "./linking.ts";
import { NOW, world } from "./test-helpers.ts";
import { codeOf, key } from "./test-join.ts";

const context: JoinContext = { now: NOW, clientIp: null, key, limits: JOIN_LIMITS };

const database = committedTestDbPerCase();

/** The world with a code on in a lab of each of its two simulations. */
async function twoCodes() {
  const { db } = database();
  const w = await world(db);
  return {
    ...w,
    first: await codeOf(db, w.teacher, w.labId),
    second: await codeOf(db, w.outsiderTeacher, w.outsideLabId),
  };
}

async function placesOf(userId: string) {
  return database()
    .db.selectFrom("lab_members")
    .select(["simulation_id", "lab_id"])
    .where("user_id", "=", userId)
    .execute();
}

describe("two joins of one student into two simulations at once (#379)", () => {
  it("leaves one place when both run in parallel", async () => {
    const { db } = database();
    const w = await twoCodes();
    const results = await Promise.all([
      joinLabWithCode(db, w.stranger, { code: w.first }, context),
      joinLabWithCode(db, w.stranger, { code: w.second }, context),
    ]);
    const places = await placesOf(w.stranger.id);
    expect(places).toHaveLength(1);
    const errors = results.map((result) => (result.ok ? result.value.status : result.error));
    expect(errors.sort()).toEqual(["in_other_simulation", "joined"]);
    const winner = results.find((result) => result.ok);
    expect(winner?.ok && winner.value.labId).toBe(places[0]?.lab_id);
  });

  it("makes the second join wait for the first and then refuses it (forced order)", async () => {
    const { db, pool } = database();
    const w = await twoCodes();
    const client = await pool.connect();
    try {
      // The first join, held open after it took the student's place in the second simulation.
      await client.query("begin");
      await client.query("select id from simulations where id = $1 for share", [
        w.outsideSimulationId,
      ]);
      await client.query(
        "insert into lab_members (simulation_id, lab_id, user_id, joined_via) values ($1, $2, $3, 'code')",
        [w.outsideSimulationId, w.outsideLabId, w.stranger.id],
      );
      const second = joinLabWithCode(db, w.stranger, { code: w.first }, context);
      expect(await settlesWithin(second, 300)).toBe(false);
      await client.query("commit");
      expect(await second).toEqual({ ok: false, error: "in_other_simulation" });
    } finally {
      client.release();
    }
    expect(await placesOf(w.stranger.id)).toEqual([
      { simulation_id: w.outsideSimulationId, lab_id: w.outsideLabId },
    ]);
  });

  it("lets the second join in when the first rolls back (forced order)", async () => {
    const { db, pool } = database();
    const w = await twoCodes();
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        "insert into lab_members (simulation_id, lab_id, user_id, joined_via) values ($1, $2, $3, 'code')",
        [w.outsideSimulationId, w.outsideLabId, w.stranger.id],
      );
      const second = joinLabWithCode(db, w.stranger, { code: w.first }, context);
      expect(await settlesWithin(second, 300)).toBe(false);
      await client.query("rollback");
      expect(await second).toEqual({
        ok: true,
        value: expect.objectContaining({ status: "joined", labId: w.labId }),
      });
    } finally {
      client.release();
    }
    expect(await placesOf(w.stranger.id)).toEqual([
      { simulation_id: w.simulationId, lab_id: w.labId },
    ]);
  });

  it("refuses a join that meets a link into another simulation, in either order", async () => {
    const { db } = database();
    const w = await twoCodes();
    await addEmails(
      db,
      w.outsiderTeacher,
      { labId: w.outsideLabId, emails: [w.stranger.email] },
      NOW,
    );
    const [joined, linked] = await Promise.all([
      joinLabWithCode(db, w.stranger, { code: w.first }, context),
      linkWaitingAddresses(db, w.stranger.id, NOW),
    ]);
    expect(await placesOf(w.stranger.id)).toHaveLength(1);
    expect(Number(joined.ok) + linked.linked).toBe(1);
  });
});

describe("the trigger under concurrency, with no service check (#379)", () => {
  it("refuses the second of two raw writes into two simulations once the first commits", async () => {
    const { db, pool } = database();
    const w = await world(db);
    const first = await pool.connect();
    const second = await pool.connect();
    try {
      await first.query("begin");
      await first.query(
        "insert into lab_members (simulation_id, lab_id, user_id, joined_via) values ($1, $2, $3, 'code')",
        [w.simulationId, w.labId, w.stranger.id],
      );
      await second.query("begin");
      const write = second.query(
        "insert into lab_members (simulation_id, lab_id, user_id, joined_via) values ($1, $2, $3, 'code')",
        [w.outsideSimulationId, w.outsideLabId, w.stranger.id],
      );
      // Caught here so the rejection is never unhandled while the first write is still open.
      const outcome = write.then(
        () => "written",
        (error: unknown) => error,
      );
      expect(await settlesWithin(outcome, 300)).toBe(false);
      await first.query("commit");
      expect(await outcome).toMatchObject({
        code: "23514",
        constraint: "lab_members_one_active_simulation",
      });
      await second.query("rollback");
    } finally {
      first.release();
      second.release();
    }
    expect(await placesOf(w.stranger.id)).toEqual([
      { simulation_id: w.simulationId, lab_id: w.labId },
    ]);
  });
});
