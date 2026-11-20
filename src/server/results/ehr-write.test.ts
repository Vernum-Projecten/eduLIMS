// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The released result in the patient's record on a real database with FerroEHR stubbed (#148,
// S15, Q-PRIV-1, reliability.md "Idempotent writes"): the EHR must exist before a release, the
// release commits a pending write with it, a failed or slow write stays pending and is retried,
// and a retry never writes a second composition (the retry run: ehr-write-retry.test.ts). Values
// are invented (Q-PRIV-4).
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { recordRequest } from "../lab-records/requests.ts";
import { AuthError } from "../middleware.ts";
import { finalResultContributionUid } from "../openehr/contribution.ts";
import { success } from "../openehr/errors.ts";
import { finishSimulation } from "../simulations/state.ts";
import { auditRows, NOW, securityLines } from "../simulations/test-helpers.ts";
import { ensureReleaseEhr, writeReleasedResult } from "./ehr-write.ts";
import { releaseResult } from "./release.ts";
import {
  analyserDeps,
  ferroEhr,
  input,
  NEW_EHR,
  released,
  SETTINGS,
  unreachable,
  VERSION,
  writeRow,
} from "./test-ehr-write.ts";
import { measure, resultsWorld } from "./test-helpers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function open() {
  const database = await createTestDb();
  db = database;
  return { database, w: await resultsWorld(database) };
}

describe("the EHR before a release (#148, #364)", () => {
  it("passes a patient whose EHR is resolved, without asking FerroEHR", async () => {
    const { database, w } = await open();
    const { client } = ferroEhr();
    expect(await ensureReleaseEhr(database, client, w.student, input(w, "x"))).toEqual({
      ok: true,
      value: null,
    });
    expect(client.getEhrBySubject).not.toHaveBeenCalled();
  });

  it("resolves a pending EHR and stores its id", async () => {
    const { database, w } = await open();
    await database.updateTable("patients").set({ ehr_id: null }).execute();
    const { client } = ferroEhr();
    expect(await ensureReleaseEhr(database, client, w.student, input(w, "x"))).toMatchObject({
      ok: true,
    });
    const row = await database.selectFrom("patients").select("ehr_id").executeTakeFirstOrThrow();
    expect(row.ehr_id).toBe(NEW_EHR);
  });

  it("refuses ehr_pending while FerroEHR does not answer, with an activity-log row", async () => {
    const { database, w } = await open();
    await database.updateTable("patients").set({ ehr_id: null }).execute();
    const { client } = ferroEhr();
    client.getEhrBySubject.mockImplementation(async () => unreachable());
    expect(await ensureReleaseEhr(database, client, w.student, input(w, "x"))).toEqual({
      ok: false,
      error: "ehr_pending",
    });
    expect(await auditRows(database, "lab_result_released")).toEqual([
      expect.objectContaining({
        actor_id: w.student.id,
        outcome: "refused",
        reason_code: "ehr_pending",
      }),
    ]);
  });

  it("never resolves the EHR of another lab's patient (S10, #147)", async () => {
    const { database, w } = await open();
    await database.updateTable("patients").set({ ehr_id: null }).execute();
    const { client } = ferroEhr();
    for (const labId of [w.labId, w.otherLabId]) {
      const asked = { ...input(w, "x"), labId };
      expect(await ensureReleaseEhr(database, client, w.otherLabStudent, asked)).toMatchObject({
        ok: true,
      });
    }
    expect(client.getEhrBySubject).not.toHaveBeenCalled();
  });

  it("asks FerroEHR nothing in a finished simulation, and the release refuses not_running (#382, D10)", async () => {
    const { database, w } = await open();
    await database.updateTable("patients").set({ ehr_id: null }).execute();
    const id = await measure(database, w, "5.3");
    const finished = await finishSimulation(
      database,
      w.teacher,
      { simulationId: w.simulationId },
      NOW,
    );
    expect(finished.ok).toBe(true);
    const { client } = ferroEhr();
    expect(await ensureReleaseEhr(database, client, w.student, input(w, id))).toEqual({
      ok: true,
      value: null,
    });
    expect(await releaseResult(database, w.student, input(w, id))).toEqual({
      ok: false,
      error: "not_running",
    });
    expect(client.getEhrBySubject).not.toHaveBeenCalled();
    expect(client.createEhr).not.toHaveBeenCalled();
    const reasons = (await auditRows(database, "lab_result_released")).map((r) => r.reason_code);
    expect(reasons).not.toContain("ehr_pending");
  });

  it("asks nothing for a control request, which has no patient (S16)", async () => {
    const { database, w } = await open();
    const control = await recordRequest(database, w.student, {
      kind: "control",
      labId: w.labId,
      requester: null,
      phoneThrough: false,
      remarks: null,
      testIds: [w.hba1c],
      samples: [{ sampleNumber: "QC-1", material: "control" }],
    });
    if (!control.ok) throw new Error(control.error);
    const { client } = ferroEhr();
    const asked = { ...input(w, "x"), requestId: control.value.requestId };
    expect(await ensureReleaseEhr(database, client, w.student, asked)).toMatchObject({ ok: true });
    expect(client.getEhrBySubject).not.toHaveBeenCalled();
  });

  it("refuses a teacher (403)", async () => {
    const { database, w } = await open();
    const { client } = ferroEhr();
    await expect(ensureReleaseEhr(database, client, w.teacher, input(w, "x"))).rejects.toThrow(
      AuthError,
    );
  });
});

describe("the release and its pending write (#148)", () => {
  it("commits a pending write keyed by the measurement with the release", async () => {
    const { database, w } = await open();
    const id = await released(database, w);
    const row = await writeRow(database, id);
    expect(row).toMatchObject({
      state: "pending",
      contribution_uid: finalResultContributionUid(id),
      version_uid: null,
      attempts: 0,
      last_error: null,
    });
    expect(row.pause_s).toBeGreaterThan(0);
  });

  it("refuses a release whose patient has no EHR yet, and stores nothing", async () => {
    const { database, w } = await open();
    await database.updateTable("patients").set({ ehr_id: null }).execute();
    const id = await measure(database, w, "5.3");
    expect(await releaseResult(database, w.student, input(w, id))).toEqual({
      ok: false,
      error: "ehr_pending",
    });
    const writes = await database
      .selectFrom("result_ehr_writes")
      .select("measurement_id")
      .execute();
    expect(writes).toEqual([]);
  });

  it("keeps a written result written: the row refuses any change (S15)", async () => {
    const { database, w } = await open();
    const id = await released(database, w);
    await writeReleasedResult(analyserDeps(database, ferroEhr().client), id);
    await expect(
      database.updateTable("result_ehr_writes").set({ last_error: "x" }).execute(),
    ).rejects.toThrow(/a written result stays written/);
  });
});

describe("writeReleasedResult (#148)", () => {
  it("writes the Final composition and marks the row written with its version", async () => {
    const { database, w } = await open();
    const id = await released(database, w);
    const { client, stored } = ferroEhr();
    expect(await writeReleasedResult(analyserDeps(database, client), id)).toBe("written");
    expect(await writeRow(database, id)).toMatchObject({
      state: "written",
      version_uid: VERSION,
      last_error: null,
    });
    const [ehrId, body] = client.createContribution.mock.calls[0] ?? [];
    expect(ehrId).toBe(w.ehrId);
    expect(stored.size).toBe(1);
    const text = JSON.stringify(body);
    expect(text).toContain("5.3");
    for (const secret of [w.student.id, w.student.email, w.toleranceId, w.teacher.id]) {
      expect(text).not.toContain(secret);
    }
  });

  it("asks FerroEHR nothing again once written", async () => {
    const { database, w } = await open();
    const id = await released(database, w);
    const { client } = ferroEhr();
    await writeReleasedResult(analyserDeps(database, client), id);
    expect(await writeReleasedResult(analyserDeps(database, client), id)).toBe("written");
    expect(client.createContribution).toHaveBeenCalledTimes(1);
  });

  it("writes a result entered by hand under the fixed device identity (maintainer, 2026-11-20)", async () => {
    const { database, w } = await open();
    const id = await released(database, w);
    const { client } = ferroEhr();
    expect(await writeReleasedResult({ db: database, client, settings: SETTINGS }, id)).toBe(
      "written",
    );
    const [, body] = client.createContribution.mock.calls[0] ?? [];
    expect(body?.versions[0]?.data["composer"]).toMatchObject({ name: "eduLIMS manual entry" });
  });

  it("leaves an analyser's result without its serial number pending, logged with ids only (#158, #152)", async () => {
    const { database, w } = await open();
    const id = await released(database, w, "5.37");
    const { client } = ferroEhr();
    const deps = {
      db: database,
      client,
      settings: SETTINGS,
      resolveDevice: () => ({ kind: "afinion_2", serialNumber: null }) as const,
    };
    const lines = await securityLines(() => writeReleasedResult(deps, id));
    expect(await writeRow(database, id)).toMatchObject({
      state: "pending",
      attempts: 1,
      last_error: "build:no_device_identifier",
    });
    expect(client.createContribution).not.toHaveBeenCalled();
    expect(lines).toEqual([
      expect.objectContaining({
        event: "ferroehr_result_pending",
        level: "error",
        target_id: id,
        reason: "build:no_device_identifier",
      }),
    ]);
    expect(JSON.stringify(lines)).not.toContain("5.37");
  });

  it("stays pending while FerroEHR does not answer, and pauses longer after each failure", async () => {
    const { database, w } = await open();
    const id = await released(database, w);
    const { client } = ferroEhr();
    client.createContribution.mockImplementation(async () => unreachable());
    const deps = analyserDeps(database, client);
    expect(await writeReleasedResult(deps, id)).toBe("pending");
    const first = await writeRow(database, id);
    expect(first).toMatchObject({ attempts: 1, last_error: "openehr:unreachable" });
    await writeReleasedResult(deps, id);
    const second = await writeRow(database, id);
    expect(second.attempts).toBe(2);
    expect(second.pause_s).toBeGreaterThan(first.pause_s);
  });

  it("answers pending past its budget, and the write that lands later marks the row", async () => {
    const { database, w } = await open();
    const id = await released(database, w);
    const { client } = ferroEhr();
    let land: () => void = () => {};
    const slow = new Promise<void>((resolve) => {
      land = resolve;
    });
    client.createContribution.mockImplementationOnce(async (_, body) => {
      await slow;
      return success({
        outcome: "created" as const,
        contribution: { uid: { value: body.uid.value }, versions: [{ id: { value: VERSION } }] },
      });
    });
    expect(await writeReleasedResult(analyserDeps(database, client), id, { budgetMs: 20 })).toBe(
      "pending",
    );
    land();
    await vi.waitFor(async () => expect((await writeRow(database, id)).state).toBe("written"));
  });

  it("logs an unexpected error as ferroehr_result_failed and answers pending", async () => {
    const { database, w } = await open();
    const id = await released(database, w);
    const { client } = ferroEhr();
    client.createContribution.mockImplementation(async () => {
      throw new Error("boom");
    });
    const lines = await securityLines(async () => {
      expect(await writeReleasedResult(analyserDeps(database, client), id)).toBe("pending");
    });
    expect(lines).toEqual([
      expect.objectContaining({ event: "ferroehr_result_failed", target_id: id }),
    ]);
    expect((await writeRow(database, id)).state).toBe("pending");
  });
});
