// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Races of an upload and its link on a committed database (S4, S10, S14, S15, D10). The first
// write holds its row locks while a pool client holds the activity log in SHARE mode (no insert
// passes); the write behind it waits on a lock, and after the commit sees the committed state.
import type { Pool, PoolClient } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { type CommittedTestDb, createCommittedTestDb } from "../db/test-committed-db.ts";
import { releaseResult } from "../results/release.ts";
import { toleranceFor } from "../results/test-helpers.ts";
import { moveMember } from "../simulations/members.ts";
import { finishSimulation } from "../simulations/state.ts";
import { NOW } from "../simulations/test-helpers.ts";
import {
  AIR_FILE,
  gen5Fixture,
  link,
  linkOf,
  type UploadWorld,
  uploaded,
  uploadWorld,
} from "./test-helpers.ts";
import { storeGen5Upload } from "./uploads.ts";

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
  const w = await uploadWorld(c.db);
  const uploadId = await uploaded(c.db, w.student, w.labId);
  return { c, w, uploadId };
}

/** Links a first upload, so its measurement can be released, and stores a second one. */
async function withReleasable(c: CommittedTestDb, w: UploadWorld) {
  const first = await link(c.db, w, linkOf(w, await uploaded(c.db, w.student, w.labId)));
  if (!first.ok) throw new Error(first.error);
  const measurement = first.value.measurements[0];
  if (!measurement) throw new Error("no measurement");
  const toleranceId = await toleranceFor(c.db, w.student, w.labId, w.teamTest, "1.0", "9.0");
  const release = () =>
    releaseResult(c.db, w.labStudents[1] ?? w.student, {
      labId: w.labId,
      requestId: w.epochRequestId,
      testId: w.teamTest,
      measurementId: measurement.measurementId,
      toleranceId,
    });
  return { release };
}

async function epochMeasurements(c: CommittedTestDb): Promise<number> {
  const rows = await c.db
    .selectFrom("measurements")
    .select("id")
    .where("source", "=", "epoch_upload")
    .execute();
  return rows.length;
}

async function releasedCount(c: CommittedTestDb, w: UploadWorld): Promise<number> {
  const rows = await c.db
    .selectFrom("request_tests")
    .select("test_id")
    .where("request_id", "=", w.epochRequestId)
    .where("released_at", "is not", null)
    .execute();
  return rows.length;
}

describe("a link against a finish of the simulation (D10, #267)", () => {
  it("is refused not_running behind a finish, storing nothing", async () => {
    const { c, w, uploadId } = await setUp();
    const holder = await holdAuditLog(c.pool);
    const first = finishSimulation(c.db, w.teacher, { simulationId: w.simulationId }, NOW);
    await waitForLockWaiters(c.pool, 1);
    const second = link(c.db, w, linkOf(w, uploadId));
    await waitForLockWaiters(c.pool, 2);
    await letGo(holder);
    expect(await first).toEqual({ ok: true, value: null });
    expect(await second).toEqual({ ok: false, error: "not_running" });
    expect(await epochMeasurements(c)).toBe(0);
  });

  it("lets a finish wait for a link that started first", async () => {
    const { c, w, uploadId } = await setUp();
    const holder = await holdAuditLog(c.pool);
    const first = link(c.db, w, linkOf(w, uploadId));
    await waitForLockWaiters(c.pool, 1);
    const second = finishSimulation(c.db, w.teacher, { simulationId: w.simulationId }, NOW);
    await waitForLockWaiters(c.pool, 2);
    await letGo(holder);
    expect((await first).ok).toBe(true);
    expect(await second).toEqual({ ok: true, value: null });
    expect(await epochMeasurements(c)).toBe(1);
  });

  it("refuses an upload behind a finish, storing nothing", async () => {
    const { c, w } = await setUp();
    const holder = await holdAuditLog(c.pool);
    const first = finishSimulation(c.db, w.teacher, { simulationId: w.simulationId }, NOW);
    await waitForLockWaiters(c.pool, 1);
    const second = storeGen5Upload(c.db, w.student, {
      labId: w.labId,
      fileName: AIR_FILE,
      bytes: gen5Fixture(),
    });
    await waitForLockWaiters(c.pool, 2);
    await letGo(holder);
    expect((await first).ok).toBe(true);
    expect(await second).toEqual({ ok: false, error: "not_running" });
    const uploads = await c.db.selectFrom("uploads").select("id").execute();
    expect(uploads).toHaveLength(1);
  });
});

describe("a link against a move of the student (S10)", () => {
  it("is refused not_found behind a move to another lab, storing nothing", async () => {
    const { c, w, uploadId } = await setUp();
    const holder = await holdAuditLog(c.pool);
    const first = moveMember(c.db, w.teacher, {
      simulationId: w.simulationId,
      userId: w.student.id,
      labId: w.otherLabId,
    });
    await waitForLockWaiters(c.pool, 1);
    const second = link(c.db, w, linkOf(w, uploadId));
    await waitForLockWaiters(c.pool, 2);
    await letGo(holder);
    expect(await first).toEqual({ ok: true, value: null });
    expect(await second).toEqual({ ok: false, error: "not_found" });
    expect(await epochMeasurements(c)).toBe(0);
  });
});

describe("a link against a release of the same requested test (S14, S15)", () => {
  it("lands beside a release that commits first; the release stays final", async () => {
    const { c, w, uploadId } = await setUp();
    const { release } = await withReleasable(c, w);
    const holder = await holdAuditLog(c.pool);
    const first = release();
    await waitForLockWaiters(c.pool, 1);
    const second = link(c.db, w, linkOf(w, uploadId));
    await waitForLockWaiters(c.pool, 2);
    await letGo(holder);
    expect((await first).ok).toBe(true);
    expect((await second).ok).toBe(true);
    expect(await epochMeasurements(c)).toBe(2);
    expect(await releasedCount(c, w)).toBe(1);
  });

  it("lets a release wait for a link that started first", async () => {
    const { c, w, uploadId } = await setUp();
    const { release } = await withReleasable(c, w);
    const holder = await holdAuditLog(c.pool);
    const first = link(c.db, w, linkOf(w, uploadId));
    await waitForLockWaiters(c.pool, 1);
    const second = release();
    await waitForLockWaiters(c.pool, 2);
    await letGo(holder);
    expect((await first).ok).toBe(true);
    expect((await second).ok).toBe(true);
    expect(await epochMeasurements(c)).toBe(2);
    expect(await releasedCount(c, w)).toBe(1);
  });
});

describe("two links of one upload (S4)", () => {
  it("link it once; the second is refused already_linked", async () => {
    const { c, w, uploadId } = await setUp();
    const holder = await holdAuditLog(c.pool);
    const first = link(c.db, w, linkOf(w, uploadId));
    await waitForLockWaiters(c.pool, 1);
    const second = link(c.db, w, linkOf(w, uploadId), w.labStudents[1] ?? w.student);
    await waitForLockWaiters(c.pool, 2);
    await letGo(holder);
    expect((await first).ok).toBe(true);
    expect(await second).toEqual({ ok: false, error: "already_linked" });
    expect(await epochMeasurements(c)).toBe(1);
  });
});
