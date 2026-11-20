// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Corrections against a teacher's write, on a committed database (S11, S12, S10; security review
// of #351): correctPatient and correctRequest each meet finishSimulation, moveMember and
// deleteLab. The teacher's write holds the simulation row FOR UPDATE and waits on a held
// activity log; the correction waits on the simulation row FOR SHARE. Once the teacher's write
// commits, the correction sees it, so each pair ends in exactly one outcome.
import type { Pool, PoolClient } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { type CommittedTestDb, createCommittedTestDb } from "../db/test-committed-db.ts";
import { deleteLab } from "../simulations/labs.ts";
import { moveMember } from "../simulations/members.ts";
import { finishSimulation } from "../simulations/state.ts";
import { NOW } from "../simulations/test-helpers.ts";
import type { RecordsResult } from "./access.ts";
import { correctPatient } from "./patients.ts";
import { correctRequest } from "./requests.ts";
import { PATIENT, patientIn, type RecordsWorld, recordsWorld, requestFor } from "./test-helpers.ts";

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

type TeacherWrite = "finish" | "move" | "delete";
type Correction = "patient" | "request";

const TEACHER_OUTCOME: Record<TeacherWrite, unknown> = {
  finish: { ok: true, value: null },
  move: { ok: true, value: null },
  delete: { ok: false, error: "has_students" },
};

const CORRECTION_OUTCOME: Record<TeacherWrite, RecordsResult<{ changed: number }>> = {
  finish: { ok: false, error: "not_running" },
  move: { ok: false, error: "not_found" },
  delete: { ok: true, value: { changed: 1 } },
};

function teacherWrite(c: CommittedTestDb, w: RecordsWorld, write: TeacherWrite) {
  switch (write) {
    case "finish":
      return finishSimulation(c.db, w.teacher, { simulationId: w.simulationId }, NOW);
    case "move":
      return moveMember(c.db, w.teacher, {
        simulationId: w.simulationId,
        userId: w.student.id,
        labId: w.otherLabId,
      });
    case "delete":
      return deleteLab(c.db, w.teacher, { labId: w.labId });
    default: {
      const unknown: never = write;
      return unknown;
    }
  }
}

/** Runs `write` first, held before its commit, then the correction behind it. */
async function race(write: TeacherWrite, correction: Correction) {
  committed = await createCommittedTestDb(6);
  const c = committed;
  const w = await recordsWorld(c.db);
  const patientId = await patientIn(c.db, w.student, w.labId);
  const request = await requestFor(c.db, w.student, w.labId, patientId, [w.hba1c]);
  const sampleId = request.samples[0]?.id ?? "";
  holder = await c.pool.connect();
  await holder.query("begin");
  await holder.query("lock table audit_event in share mode");
  const first = teacherWrite(c, w, write);
  await waitForLockWaiters(c.pool, 1);
  const second =
    correction === "patient"
      ? correctPatient(c.db, w.student, {
          labId: w.labId,
          patientId,
          ...PATIENT,
          name: "Ada Raced",
        })
      : correctRequest(c.db, w.student, {
          labId: w.labId,
          requestId: request.requestId,
          requester: "Dr. Raced",
          phoneThrough: false,
          remarks: null,
          testIds: [w.hba1c],
          samples: [{ sampleId, sampleNumber: "S-001", material: "whole blood" }],
        });
  await waitForLockWaiters(c.pool, 2);
  await holder.query("commit");
  holder.release();
  holder = undefined;
  expect(await first).toEqual(TEACHER_OUTCOME[write]);
  expect(await second).toEqual(CORRECTION_OUTCOME[write]);
  const corrections = await c.db.selectFrom("record_corrections").select("id").execute();
  expect(corrections).toHaveLength(write === "delete" ? 1 : 0);
}

describe("a correction against a teacher's write that commits first (S11, S12, S10)", () => {
  for (const write of ["finish", "move", "delete"] as const) {
    for (const correction of ["patient", "request"] as const) {
      it(`${correction} correction after ${write}: one outcome`, async () => {
        await race(write, correction);
      });
    }
  }
});
