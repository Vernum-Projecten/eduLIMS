// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// One simulation at a time against a finish, on a committed database (review of #392): a join
// into B while the student's simulation A finishes gives a clean answer in every order; a link
// that waits behind a finish of its own simulation refuses with `simulation_finished`; and a link
// already refused for another simulation takes no lock on the next overview read (S2).
import { describe, expect, it } from "vitest";
import { committedTestDbPerCase } from "../db/test-committed-hooks.ts";
import { lockWaiters, settlesWithin } from "../db/test-lock-waiters.ts";
import { type JoinContext, joinLabWithCode } from "./join.ts";
import { JOIN_LIMITS } from "./join-limits.ts";
import { linkWaitingAddresses } from "./linking.ts";
import { finishSimulation } from "./state.ts";
import { auditRows, NOW, setState, world } from "./test-helpers.ts";
import { codeOf, key } from "./test-join.ts";

const context: JoinContext = { now: NOW, clientIp: null, key, limits: JOIN_LIMITS };

const database = committedTestDbPerCase();

/** The world with its first simulation (A, the student's) running and a code on in B. */
async function runningWithCode() {
  const { db } = database();
  const w = await world(db);
  await setState(db, w.simulationId, "running");
  return { ...w, codeB: await codeOf(db, w.outsiderTeacher, w.outsideLabId) };
}

describe("a join into B while the student's simulation A finishes (review of #392)", () => {
  it("answers in_other_simulation while the finish is open, and joins once it commits", async () => {
    const { db, pool } = database();
    const w = await runningWithCode();
    const holder = await pool.connect();
    try {
      await holder.query("begin");
      await holder.query(
        "update simulations set state = 'finished', finished_at = now() where id = $1",
        [w.simulationId],
      );
      expect(await joinLabWithCode(db, w.student, { code: w.codeB }, context)).toEqual({
        ok: false,
        error: "in_other_simulation",
      });
      await holder.query("commit");
    } finally {
      holder.release();
    }
    expect(await joinLabWithCode(db, w.student, { code: w.codeB }, context)).toEqual({
      ok: true,
      value: expect.objectContaining({ status: "joined", labId: w.outsideLabId }),
    });
  });

  it("never throws when the finish and the join run in parallel", async () => {
    const { db } = database();
    const w = await runningWithCode();
    const [finished, joined] = await Promise.all([
      finishSimulation(db, w.teacher, { simulationId: w.simulationId }, NOW),
      joinLabWithCode(db, w.student, { code: w.codeB }, context),
    ]);
    expect(finished).toEqual({ ok: true, value: null });
    if (joined.ok) expect(joined.value.labId).toBe(w.outsideLabId);
    else expect(joined.error).toBe("in_other_simulation");
  });
});

describe("a link behind a finish of its own simulation (review of #392, N2)", () => {
  it("waits, then refuses with simulation_finished, logged, and links nothing", async () => {
    const { db, pool } = database();
    const w = await world(db);
    await db
      .insertInto("lab_member_emails")
      .values({ simulation_id: w.simulationId, lab_id: w.labId, email: w.stranger.email })
      .execute();
    const holder = await pool.connect();
    try {
      await holder.query("begin");
      await holder.query(
        "update simulations set state = 'finished', started_at = now(), finished_at = now() where id = $1",
        [w.simulationId],
      );
      const link = linkWaitingAddresses(db, w.stranger.id, NOW);
      await lockWaiters(database(), 1);
      await holder.query("commit");
      expect(await link).toEqual({ linked: 0, refused: 1, failed: 0 });
    } finally {
      holder.release();
    }
    const rows = await db
      .selectFrom("lab_members")
      .select("lab_id")
      .where("user_id", "=", w.stranger.id)
      .execute();
    expect(rows).toEqual([]);
    expect(
      (await auditRows(db, "lab_member_joined")).filter((row) => row.actor_id === w.stranger.id),
    ).toEqual([
      expect.objectContaining({ outcome: "refused", reason_code: "simulation_finished" }),
    ]);
  });
});

describe("a link refused for another simulation, read again (security review of #392, S2)", () => {
  it("returns without waiting while another transaction holds that simulation's row", async () => {
    const { db, pool } = database();
    const w = await world(db);
    await db
      .insertInto("lab_member_emails")
      .values({ simulation_id: w.simulationId, lab_id: w.labId, email: w.outsideStudent.email })
      .execute();
    // The first read logs the refusal under the lock.
    expect(await linkWaitingAddresses(db, w.outsideStudent.id, NOW)).toEqual({
      linked: 0,
      refused: 1,
      failed: 0,
    });
    const holder = await pool.connect();
    try {
      await holder.query("begin");
      await holder.query("select id from simulations where id = $1 for share", [w.simulationId]);
      const again = linkWaitingAddresses(db, w.outsideStudent.id, NOW);
      expect(await settlesWithin(again, 1_000)).toBe(true);
      expect(await again).toEqual({ linked: 0, refused: 1, failed: 0 });
      await holder.query("commit");
    } finally {
      holder.release();
    }
  });
});
