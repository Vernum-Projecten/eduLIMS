// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Joining a lab with a code under concurrency (#288; the security review of #119: H1, L1, F3):
// parallel wrong codes, parallel joins against the limit of uses, parallel joins of one student
// into two labs, and a join that meets a lab delete, a new code, or a writer that locks the code
// row before the simulation. These need real, committing transactions.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CommittedTestDb, createCommittedTestDb } from "../db/test-committed-db.ts";
import { type JoinContext, joinLabWithCode } from "./join.ts";
import { JOIN_LIMITS } from "./join-limits.ts";
import { auditRows, NOW, person, world } from "./test-helpers.ts";
import { codeOf, key, labOf, WRONG } from "./test-join.ts";

const context: JoinContext = { now: NOW, clientIp: null, key, limits: JOIN_LIMITS };

let committed: CommittedTestDb | undefined;

beforeEach(async () => {
  committed = await createCommittedTestDb(12);
}, 60_000);

afterEach(async () => {
  await committed?.destroy();
  committed = undefined;
}, 60_000);

function database(): CommittedTestDb {
  if (!committed) throw new Error("no committed test database");
  return committed;
}

async function worldWithCode(maxUses = 30) {
  const { db } = database();
  const w = await world(db);
  return { ...w, code: await codeOf(db, w.teacher, w.labId, { validDays: 7, maxUses }) };
}

/** Resolves to whether `promise` settles within `ms`. */
async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  const timeout = new Promise<false>((resolve) => setTimeout(() => resolve(false), ms));
  return Promise.race([promise.then(() => true), timeout]);
}

describe("joining with a code in parallel (#288, review H1)", () => {
  it("answers 50 parallel wrong codes of one student with exactly the limit of invalid_code", async () => {
    const { db } = database();
    const w = await worldWithCode();
    const results = await Promise.all(
      Array.from({ length: 50 }, () => joinLabWithCode(db, w.stranger, { code: WRONG }, context)),
    );
    const errors = results.map((result) => (result.ok ? "ok" : result.error));
    expect(errors.filter((error) => error === "invalid_code")).toHaveLength(JOIN_LIMITS.user);
    expect(errors.filter((error) => error === "rate_limited")).toHaveLength(50 - JOIN_LIMITS.user);
    const rows = (await auditRows(db, "lab_join_failed")).filter(
      (row) => row.actor_id === w.stranger.id,
    );
    expect(rows.length).toBeLessThanOrEqual(JOIN_LIMITS.user + 1);
  });

  it("never lets more students join than the code allows", async () => {
    const { db } = database();
    const w = await worldWithCode(3);
    const students = await Promise.all(
      Array.from({ length: 12 }, (_, i) => person(db, `racer-${i}`, ["student"])),
    );
    const results = await Promise.all(
      students.map((student) => joinLabWithCode(db, student, { code: w.code }, context)),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(3);
    const row = await db
      .selectFrom("lab_join_codes")
      .select("uses")
      .where("lab_id", "=", w.labId)
      .executeTakeFirstOrThrow();
    expect(row.uses).toBe(3);
    const joined = await db
      .selectFrom("lab_members")
      .select("user_id")
      .where("lab_id", "=", w.labId)
      .where(
        "user_id",
        "in",
        students.map((student) => student.id),
      )
      .execute();
    expect(joined).toHaveLength(3);
  });

  it("puts one student who types two labs' codes at once in one lab only (S10)", async () => {
    const { db } = database();
    const w = await worldWithCode();
    const other = await codeOf(db, w.teacher, w.otherLabId);
    const results = await Promise.all(
      [w.code, other, w.code, other].map((code) =>
        joinLabWithCode(db, w.stranger, { code }, context),
      ),
    );
    const places = await db
      .selectFrom("lab_members")
      .select("lab_id")
      .where("simulation_id", "=", w.simulationId)
      .where("user_id", "=", w.stranger.id)
      .execute();
    expect(places).toHaveLength(1);
    const lab = places[0]?.lab_id;
    for (const result of results) {
      if (result.ok) expect(result.value.labId).toBe(lab);
      else expect(result.error).toBe("in_other_lab");
    }
    expect(results.filter((result) => result.ok && result.value.status === "joined")).toHaveLength(
      1,
    );
  });
});

describe("a join meeting another lab write (#288, review L1)", () => {
  it("waits for a lab delete and then refuses the code of the deleted lab", async () => {
    const { db, pool } = database();
    const w = await world(db);
    const lab = await db
      .insertInto("labs")
      .values({ simulation_id: w.simulationId, name: "Short-lived Lab" })
      .returning("id")
      .executeTakeFirstOrThrow();
    const code = await codeOf(db, w.teacher, lab.id);
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select id from simulations where id = $1 for update", [w.simulationId]);
      await client.query("delete from labs where id = $1", [lab.id]);
      const join = joinLabWithCode(db, w.stranger, { code }, context);
      expect(await settlesWithin(join, 300)).toBe(false);
      await client.query("commit");
      expect(await join).toEqual({ ok: false, error: "invalid_code" });
    } finally {
      client.release();
    }
    expect(await labOf(db, w.simulationId, w.stranger.id)).toBeNull();
    expect(await auditRows(db, "lab_join_failed")).toEqual([
      expect.objectContaining({ reason_code: "lab_deleted", target_id: lab.id }),
    ]);
  });

  it("waits for a new code and then refuses the old one", async () => {
    const { db, pool } = database();
    const w = await worldWithCode();
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select id from simulations where id = $1 for update", [w.simulationId]);
      await client.query("update lab_join_codes set code_hash = $1 where lab_id = $2", [
        key.hash("NEWCODE234"),
        w.labId,
      ]);
      const join = joinLabWithCode(db, w.stranger, { code: w.code }, context);
      expect(await settlesWithin(join, 300)).toBe(false);
      await client.query("commit");
      expect(await join).toEqual({ ok: false, error: "invalid_code" });
    } finally {
      client.release();
    }
    expect(await labOf(db, w.simulationId, w.stranger.id)).toBeNull();
    expect(await auditRows(db, "lab_join_failed")).toEqual([
      expect.objectContaining({ reason_code: "unknown_code", target_id: w.labId }),
    ]);
  });

  it("never deadlocks with a writer that locks the code row before the simulation (review F3)", async () => {
    const { db, pool } = database();
    const w = await worldWithCode();
    const client = await pool.connect();
    let join: Promise<Awaited<ReturnType<typeof joinLabWithCode>>> | undefined;
    try {
      await client.query("begin");
      await client.query("select uses from lab_join_codes where lab_id = $1 for update", [w.labId]);
      join = joinLabWithCode(db, w.stranger, { code: w.code }, context);
      expect(await settlesWithin(join, 200)).toBe(false);
      // The join keeps letting the simulation go while the code row is taken, so this is granted.
      await client.query("select id from simulations where id = $1 for update", [w.simulationId]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    expect(await join).toEqual({
      ok: true,
      value: expect.objectContaining({ status: "joined", labId: w.labId }),
    });
  });
});
