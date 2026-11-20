// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Races of a release on a committed database (S15, S12, S13, S10). The first write holds its row
// locks while a pool client holds the activity log in SHARE mode (no insert passes); the release
// or the other write behind it waits on a lock, and after the commit sees the committed state, so
// each pair ends in exactly one outcome. Two releases of one requested test release one result.
import type { Pool, PoolClient } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { type CommittedTestDb, createCommittedTestDb } from "../db/test-committed-db.ts";
import { parseEnv } from "../env.ts";
import { correctPatient } from "../lab-records/patients.ts";
import { correctRequest } from "../lab-records/requests.ts";
import { PATIENT } from "../lab-records/test-helpers.ts";
import { moveMember } from "../simulations/members.ts";
import { finishSimulation } from "../simulations/state.ts";
import { NOW } from "../simulations/test-helpers.ts";
import { createTestAuth } from "../test-auth.ts";
import { VALID_ENV } from "../test-env.ts";
import { setTolerance } from "../tolerances/actions.ts";
import { deleteUser } from "../users/delete-user.ts";
import { recordManualMeasurement } from "./measurements.ts";
import { releaseResult } from "./release.ts";
import { measure, type ResultsWorld, resultsWorld } from "./test-helpers.ts";

let committed: CommittedTestDb | undefined;
const held: PoolClient[] = [];

afterEach(async () => {
  for (const client of held.splice(0)) {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
  await committed?.destroy();
  committed = undefined;
});

const WAIT_MS = 10_000;

/** Waits until `count` backends of this database wait on a lock. */
async function waitForLockWaiters(pool: Pool, count: number): Promise<void> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const { rows } = await pool.query<{ n: string }>(
      `select count(*) as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'`,
    );
    if (Number(rows[0]?.n ?? 0) >= count) return;
    if (Date.now() > deadline) throw new Error(`fewer than ${count} lock waiters`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Opens a client that holds the activity log, so no write can log and commit. */
async function holdAuditLog(pool: Pool): Promise<PoolClient> {
  const client = await pool.connect();
  held.push(client);
  await client.query("begin");
  await client.query("lock table audit_event in share mode");
  return client;
}

/** Commits the holder and lets it go. */
async function letGo(client: PoolClient): Promise<void> {
  await client.query("commit");
  held.splice(held.indexOf(client), 1);
  client.release();
}

async function setUp() {
  committed = await createCommittedTestDb(8);
  const c = committed;
  const w = await resultsWorld(c.db);
  const measurementId = await measure(c.db, w, "5.2");
  return { c, w, measurementId };
}

function release(c: CommittedTestDb, w: ResultsWorld, measurementId: string) {
  return releaseResult(c.db, w.student, {
    labId: w.labId,
    requestId: w.requestId,
    testId: w.hba1c,
    measurementId,
    toleranceId: w.toleranceId,
  });
}

function correction(c: CommittedTestDb, w: ResultsWorld) {
  return correctRequest(c.db, w.labStudents[1] ?? w.student, {
    labId: w.labId,
    requestId: w.requestId,
    requester: "Dr. Raced",
    phoneThrough: false,
    remarks: null,
    testIds: [w.hba1c, w.crp],
    samples: [],
  });
}

async function releasedCount(c: CommittedTestDb, w: ResultsWorld): Promise<number> {
  const rows = await c.db
    .selectFrom("request_tests")
    .select("test_id")
    .where("request_id", "=", w.requestId)
    .where("released_at", "is not", null)
    .execute();
  return rows.length;
}

describe("two releases of one requested test (S15)", () => {
  it("release one result through the service; the second is refused", async () => {
    const { c, w, measurementId } = await setUp();
    const other = await measure(c.db, w, "5.3");
    const holder = await holdAuditLog(c.pool);
    const first = release(c, w, measurementId);
    await waitForLockWaiters(c.pool, 1);
    const second = release(c, w, other);
    await waitForLockWaiters(c.pool, 2);
    await letGo(holder);
    expect((await first).ok).toBe(true);
    expect(await second).toEqual({ ok: false, error: "released" });
    expect(await releasedCount(c, w)).toBe(1);
  });

  it("are refused by the database itself, without the service's lock", async () => {
    const { c, w, measurementId } = await setUp();
    const other = await measure(c.db, w, "5.3");
    const text = `update request_tests set released_measurement_id = $1, released_tolerance_id = $2
       where request_id = $3 and test_id = $4`;
    const values = (id: string) => [id, w.toleranceId, w.requestId, w.hba1c];
    const a = await c.pool.connect();
    const b = await c.pool.connect();
    held.push(a, b);
    await a.query("begin");
    await a.query(text, values(measurementId));
    await b.query("begin");
    const raced = b.query(text, values(other));
    await waitForLockWaiters(c.pool, 1);
    await a.query("commit");
    await expect(raced).rejects.toThrow(/a released result is final/);
    expect(await releasedCount(c, w)).toBe(1);
  });
});

describe("a release against a correction (S12, S15)", () => {
  it("waits for a correction that commits first, then releases", async () => {
    const { c, w, measurementId } = await setUp();
    const holder = await holdAuditLog(c.pool);
    const first = correction(c, w);
    await waitForLockWaiters(c.pool, 1);
    const second = release(c, w, measurementId);
    await waitForLockWaiters(c.pool, 2);
    await letGo(holder);
    expect(await first).toEqual({ ok: true, value: { changed: 1 } });
    expect((await second).ok).toBe(true);
  });

  it("refuses a correction behind a release that commits first", async () => {
    const { c, w, measurementId } = await setUp();
    const holder = await holdAuditLog(c.pool);
    const first = release(c, w, measurementId);
    await waitForLockWaiters(c.pool, 1);
    const second = correction(c, w);
    await waitForLockWaiters(c.pool, 2);
    await letGo(holder);
    expect((await first).ok).toBe(true);
    expect(await second).toEqual({ ok: false, error: "released" });
  });
});

describe("a release behind a teacher's write or a tolerance change (D10, S10, S13)", () => {
  it("is refused not_running behind a finish", async () => {
    const { c, w, measurementId } = await setUp();
    const holder = await holdAuditLog(c.pool);
    const first = finishSimulation(c.db, w.teacher, { simulationId: w.simulationId }, NOW);
    await waitForLockWaiters(c.pool, 1);
    const second = release(c, w, measurementId);
    await waitForLockWaiters(c.pool, 2);
    await letGo(holder);
    expect(await first).toEqual({ ok: true, value: null });
    expect(await second).toEqual({ ok: false, error: "not_running" });
    expect(await releasedCount(c, w)).toBe(0);
  });

  it("is refused not_found behind a move of the student to another lab", async () => {
    const { c, w, measurementId } = await setUp();
    const holder = await holdAuditLog(c.pool);
    const first = moveMember(c.db, w.teacher, {
      simulationId: w.simulationId,
      userId: w.student.id,
      labId: w.otherLabId,
    });
    await waitForLockWaiters(c.pool, 1);
    const second = release(c, w, measurementId);
    await waitForLockWaiters(c.pool, 2);
    await letGo(holder);
    expect(await first).toEqual({ ok: true, value: null });
    expect(await second).toEqual({ ok: false, error: "not_found" });
    expect(await releasedCount(c, w)).toBe(0);
  });

  it("is refused tolerance_changed behind a tolerance change of a classmate", async () => {
    const { c, w, measurementId } = await setUp();
    const holder = await holdAuditLog(c.pool);
    const first = setTolerance(c.db, w.labStudents[1] ?? w.student, {
      labId: w.labId,
      testId: w.hba1c,
      lower: "5.0",
      upper: "5.1",
    });
    await waitForLockWaiters(c.pool, 1);
    const second = release(c, w, measurementId);
    await waitForLockWaiters(c.pool, 2);
    await letGo(holder);
    expect(await first).toEqual({ ok: true, value: { changed: true } });
    expect(await second).toEqual({ ok: false, error: "tolerance_changed" });
  });
});

function manual(c: CommittedTestDb, w: ResultsWorld, value = "5.4") {
  return recordManualMeasurement(c.db, w.labStudents[1] ?? w.student, {
    labId: w.labId,
    requestId: w.requestId,
    testId: w.hba1c,
    sampleId: w.first.id,
    value,
  });
}

function patientCorrection(c: CommittedTestDb, w: ResultsWorld) {
  return correctPatient(c.db, w.labStudents[2] ?? w.student, {
    labId: w.labId,
    patientId: w.patientId,
    ...PATIENT,
    name: "Ada Raced",
  });
}

describe("a release against a measurement by hand (S14, S15; security review of #370)", () => {
  it("releases behind a measurement that commits first, which stays beside it", async () => {
    const { c, w, measurementId } = await setUp();
    const holder = await holdAuditLog(c.pool);
    const first = manual(c, w);
    await waitForLockWaiters(c.pool, 1);
    const second = release(c, w, measurementId);
    await waitForLockWaiters(c.pool, 2);
    await letGo(holder);
    expect((await first).ok).toBe(true);
    expect((await second).ok).toBe(true);
    const rows = await c.db
      .selectFrom("measurements")
      .select("id")
      .where("request_id", "=", w.requestId)
      .execute();
    expect(rows).toHaveLength(2);
  });

  it("refuses a measurement by hand behind a release that commits first", async () => {
    const { c, w, measurementId } = await setUp();
    const holder = await holdAuditLog(c.pool);
    const first = release(c, w, measurementId);
    await waitForLockWaiters(c.pool, 1);
    const second = manual(c, w);
    await waitForLockWaiters(c.pool, 2);
    await letGo(holder);
    expect((await first).ok).toBe(true);
    expect(await second).toEqual({ ok: false, error: "released" });
  });
});

describe("a release against a patient correction (S11, S15; security review of #370)", () => {
  it("releases behind a patient correction that commits first", async () => {
    const { c, w, measurementId } = await setUp();
    const holder = await holdAuditLog(c.pool);
    const first = patientCorrection(c, w);
    await waitForLockWaiters(c.pool, 1);
    const second = release(c, w, measurementId);
    await waitForLockWaiters(c.pool, 2);
    await letGo(holder);
    expect(await first).toEqual({ ok: true, value: { changed: 1 } });
    expect((await second).ok).toBe(true);
  });

  it("refuses a patient correction behind a release that commits first", async () => {
    const { c, w, measurementId } = await setUp();
    const holder = await holdAuditLog(c.pool);
    const first = release(c, w, measurementId);
    await waitForLockWaiters(c.pool, 1);
    const second = patientCorrection(c, w);
    await waitForLockWaiters(c.pool, 2);
    await letGo(holder);
    expect((await first).ok).toBe(true);
    expect(await second).toEqual({ ok: false, error: "released" });
  });
});

describe("a measurement against the deletion of its student (security review of #370, N4)", () => {
  it("lets the deletion wait for the student's place, so neither deadlocks", async () => {
    const { c, w } = await setUp();
    const student = w.labStudents[1] ?? w.student;
    const auth = await createTestAuth(parseEnv({ ...VALID_ENV, EDULIMS_DEV_LOGIN: "true" }), {
      db: c.db,
      type: "postgres",
    });
    const admin = {
      auth,
      db: c.db,
      headers: new Headers(),
      now: NOW,
      actor: { id: w.admin.id, roles: ["admin"] as const },
    };
    // The measurement takes the student's place, then waits on the request before it takes the
    // key of the student's user row, which is where the old lock order deadlocked.
    const holder = await c.pool.connect();
    held.push(holder);
    await holder.query("begin");
    await holder.query("lock table requests in exclusive mode");
    const first = manual(c, w);
    await waitForLockWaiters(c.pool, 1);
    const second = deleteUser(admin, { userId: student.id });
    await waitForLockWaiters(c.pool, 2);
    await holder.query("rollback");
    held.splice(held.indexOf(holder), 1);
    holder.release();
    expect((await first).ok).toBe(true);
    expect(await second).toEqual({ ok: true });
    const stored = await c.db
      .selectFrom("measurements")
      .select(["value", "recorded_by"])
      .where("request_id", "=", w.requestId)
      .orderBy("recorded_at")
      .execute();
    expect(stored.at(-1)).toEqual({ value: "5.4", recorded_by: null });
  });
});
