// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Races on a committed database (D9, S12; the security note on #268 from #319): a request insert
// against a catalogue edit, and against a retirement. The request reads its tests `FOR SHARE` and
// the catalogue holds a test `FOR UPDATE`, so exactly one order happens and the later transaction
// sees what the earlier one committed.
import type { Pool, PoolClient } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { parseCatalogueTestId } from "../../lib/catalogue.ts";
import { retireTest, updateTest } from "../catalogue/actions.ts";
import { type CommittedTestDb, createCommittedTestDb } from "../db/test-committed-db.ts";
import { NOW } from "../simulations/test-helpers.ts";
import { recordRequest } from "./requests.ts";
import { patientIn, recordsWorld } from "./test-helpers.ts";

let committed: CommittedTestDb | undefined;
let holder: PoolClient | undefined;

afterEach(async () => {
  await holder?.query("rollback").catch(() => undefined);
  holder?.release();
  holder = undefined;
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

/** Opens the activity-log lock that holds the first transaction just before it commits. */
async function holdAuditLog(pool: Pool): Promise<PoolClient> {
  const client = await pool.connect();
  await client.query("begin");
  await client.query("lock table audit_event in share mode");
  return client;
}

async function releaseHolder(): Promise<void> {
  await holder?.query("commit");
  holder?.release();
  holder = undefined;
}

describe("a request and a catalogue edit at once (D9, S12)", () => {
  it("makes the edit wait for the request and then refuses it in a running simulation", async () => {
    committed = await createCommittedTestDb(6);
    const { db, pool } = committed;
    const w = await recordsWorld(db);
    const patientId = await patientIn(db, w.student, w.labId);
    const testId = parseCatalogueTestId(w.crp);
    if (testId === null) throw new Error("catalogue_tests.id is not a UUID");
    holder = await holdAuditLog(pool);
    const request = recordRequest(db, w.student, {
      kind: "patient",
      labId: w.labId,
      patientId,
      requester: "Dr. Invented",
      phoneThrough: false,
      remarks: null,
      testIds: [testId],
      samples: [{ sampleNumber: "S-001", material: "whole blood" }],
    });
    await waitForLockWaiters(pool, 1);
    const edit = updateTest(
      { db, actor: w.teacher, now: NOW },
      {
        testId,
        test: {
          name: "CRP (invented)",
          unit: "mmol/L",
          material: "serum",
          source: { kind: "manual" },
        },
      },
    );
    await waitForLockWaiters(pool, 2);
    await releaseHolder();
    expect((await request).ok).toBe(true);
    expect(await edit).toEqual({ ok: false, error: "in_running_simulation" });
  });
});

describe("a request and a retirement at once (D9, S12)", () => {
  it("makes the request wait for the retirement and then refuses it", async () => {
    committed = await createCommittedTestDb(6);
    const { db, pool } = committed;
    const w = await recordsWorld(db);
    const patientId = await patientIn(db, w.student, w.labId);
    const testId = parseCatalogueTestId(w.crp);
    if (testId === null) throw new Error("catalogue_tests.id is not a UUID");
    holder = await holdAuditLog(pool);
    const retire = retireTest({ db, actor: w.teacher, now: NOW }, { testId });
    await waitForLockWaiters(pool, 1);
    const request = recordRequest(db, w.student, {
      kind: "patient",
      labId: w.labId,
      patientId,
      requester: "Dr. Invented",
      phoneThrough: false,
      remarks: null,
      testIds: [testId],
      samples: [{ sampleNumber: "S-001", material: "whole blood" }],
    });
    await waitForLockWaiters(pool, 2);
    await releaseHolder();
    expect(await retire).toEqual({ ok: true, testId });
    expect(await request).toEqual({ ok: false, error: "test_retired" });
    expect(await db.selectFrom("requests").select("id").execute()).toEqual([]);
  });
});
