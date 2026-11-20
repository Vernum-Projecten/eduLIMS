// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// A result write that keeps failing, on a real database with FerroEHR stubbed (#382, S15,
// Q-REL-1, reliability.md "Idempotent writes"): the pause is clamped before it is multiplied, a
// pending write logs once per error code, a missing release gets a defined state, and an attempt
// records its outcome only under its own lease. The test transaction fixes `now()`, so a pause is
// exact. Values are invented (Q-PRIV-4).
import { type Kysely, sql } from "kysely";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { finalResultContributionUid } from "../openehr/contribution.ts";
import type { OpenEhrResult } from "../openehr/errors.ts";
import { securityLines } from "../simulations/test-helpers.ts";
import { runPendingResultWrites, writeReleasedResult } from "./ehr-write.ts";
import { MAX_PAUSE_MINUTES } from "./ehr-write-lease.ts";
import { analyserDeps, ferroEhr, released, unreachable, writeRow } from "./test-ehr-write.ts";
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

function failingDeps(database: Kysely<DB>) {
  const { client, stored } = ferroEhr();
  client.createContribution.mockImplementation(async () => unreachable());
  return { deps: analyserDeps(database, client), client, stored };
}

/** The events of `lines` named `event`. */
function events(lines: Record<string, unknown>[], event: string) {
  return lines.filter((line) => line["event"] === event);
}

/** Lets every pending write's pause end, as the clock would. */
async function due(database: Kysely<DB>) {
  await database
    .updateTable("result_ehr_writes")
    .set({ next_attempt_at: sql`now() - interval '1 second'` })
    .execute();
}

/** A promise and the function that settles it, to hold a FerroEHR answer back. */
function gate() {
  let open: () => void = () => {};
  const closed = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { closed, open };
}

describe("the pause after a failed write (#382)", () => {
  it.each([
    [1, 2],
    [2, 4],
    [5, 32],
    [6, 60],
    [7, 60],
    [37, 60],
    [38, 60],
    [40, 60],
  ])(
    "after %i attempts, pauses %i minutes and counts the next attempt",
    async (before, minutes) => {
      const { database, w } = await open();
      const id = await released(database, w);
      await database.updateTable("result_ehr_writes").set({ attempts: before }).execute();
      const { deps } = failingDeps(database);
      expect(await writeReleasedResult(deps, id)).toBe("pending");
      const row = await writeRow(database, id);
      expect(row).toMatchObject({ state: "pending", attempts: before + 1 });
      expect(row.pause_s).toBe(minutes * 60);
      expect(row.pause_s).toBeLessThanOrEqual(MAX_PAUSE_MINUTES * 60);
    },
  );

  it("pauses one minute after the first failure", async () => {
    const { database, w } = await open();
    const id = await released(database, w);
    await writeReleasedResult(failingDeps(database).deps, id);
    expect(await writeRow(database, id)).toMatchObject({ attempts: 1, pause_s: 60 });
  });
});

describe("a write that keeps failing logs once per error code (#382)", () => {
  it("logs five failures with the same code once", async () => {
    const { database, w } = await open();
    const id = await released(database, w);
    const { deps } = failingDeps(database);
    const lines = await securityLines(async () => {
      for (let n = 0; n < 5; n += 1) await writeReleasedResult(deps, id);
    });
    expect(events(lines, "ferroehr_result_pending")).toEqual([
      expect.objectContaining({ target_id: id, reason: "openehr:unreachable" }),
    ]);
    expect(await writeRow(database, id)).toMatchObject({
      attempts: 5,
      last_error: "openehr:unreachable",
    });
  });

  it("logs again each time the code changes, and once when the write lands", async () => {
    const { database, w } = await open();
    const id = await released(database, w);
    const { deps, client } = failingDeps(database);
    const noSerial = {
      ...deps,
      resolveDevice: () => ({ kind: "afinion_2", serialNumber: null }) as const,
    };
    const lines = await securityLines(async () => {
      for (const run of [deps, deps, noSerial, noSerial, deps]) await writeReleasedResult(run, id);
      client.createContribution.mockReset();
      client.createContribution.mockImplementation(ferroEhr().client.createContribution);
      await writeReleasedResult(deps, id);
      await writeReleasedResult(deps, id);
    });
    expect(events(lines, "ferroehr_result_pending").map((line) => line["reason"])).toEqual([
      "openehr:unreachable",
      "build:no_device_identifier",
      "openehr:unreachable",
    ]);
    expect(events(lines, "ferroehr_result_written")).toHaveLength(1);
    expect(await writeRow(database, id)).toMatchObject({ state: "written", attempts: 5 });
  });

  it("logs an unexpected error once while it repeats, and keeps counting with the pause", async () => {
    const { database, w } = await open();
    const id = await released(database, w);
    const { client } = ferroEhr();
    client.createContribution.mockImplementation(async () => {
      throw new Error("boom");
    });
    const deps = analyserDeps(database, client);
    const lines = await securityLines(async () => {
      for (let n = 0; n < 3; n += 1) expect(await writeReleasedResult(deps, id)).toBe("pending");
    });
    expect(events(lines, "ferroehr_result_failed")).toHaveLength(1);
    expect(await writeRow(database, id)).toMatchObject({
      state: "pending",
      attempts: 3,
      last_error: "unexpected",
      pause_s: 4 * 60,
    });
  });
});

describe("a pending write whose release is missing (#382)", () => {
  async function orphan(database: Kysely<DB>, w: Awaited<ReturnType<typeof resultsWorld>>) {
    const id = await measure(database, w, "5.3");
    await database
      .insertInto("result_ehr_writes")
      .values({ measurement_id: id, contribution_uid: finalResultContributionUid(id) })
      .execute();
    return id;
  }

  it("stays pending with release:missing and the backoff, never the lease", async () => {
    const { database, w } = await open();
    const id = await orphan(database, w);
    const { client } = ferroEhr();
    const deps = analyserDeps(database, client);
    const lines = await securityLines(async () => {
      expect(await runPendingResultWrites(deps)).toEqual({ written: 0, pending: 1 });
      await due(database);
      expect(await runPendingResultWrites(deps)).toEqual({ written: 0, pending: 1 });
    });
    expect(await writeRow(database, id)).toMatchObject({
      state: "pending",
      attempts: 2,
      last_error: "release:missing",
      pause_s: 2 * 60,
    });
    expect(events(lines, "ferroehr_result_pending")).toEqual([
      expect.objectContaining({ target_id: id, reason: "release:missing" }),
    ]);
    expect(client.createContribution).not.toHaveBeenCalled();
  });
});

describe("the lease of one attempt (#382)", () => {
  it("leaves the attempt that holds the row to record it: one composition, one log line", async () => {
    const { database, w } = await open();
    const id = await released(database, w);
    await due(database);
    const { client, stored } = ferroEhr();
    const created = client.createContribution.getMockImplementation();
    if (!created) throw new Error("no create");
    const held = gate();
    client.createContribution.mockImplementationOnce(async (ehrId, body) => {
      const answer = await created(ehrId, body);
      await held.closed;
      return answer;
    });
    const deps = analyserDeps(database, client);
    const lines = await securityLines(async () => {
      const first = runPendingResultWrites(deps);
      await vi.waitFor(() => expect(client.createContribution).toHaveBeenCalledTimes(1));
      await due(database);
      expect(await runPendingResultWrites(deps)).toEqual({ written: 1, pending: 0 });
      held.open();
      expect(await first).toEqual({ written: 1, pending: 0 });
    });
    expect(stored.size).toBe(1);
    expect(await writeRow(database, id)).toMatchObject({ state: "written", attempts: 0 });
    expect(events(lines, "ferroehr_result_written")).toHaveLength(1);
  });

  it("counts an attempt once when two overlapping runs both fail", async () => {
    const { database, w } = await open();
    const id = await released(database, w);
    await due(database);
    const { deps, client } = failingDeps(database);
    const held = gate();
    client.createContribution.mockImplementationOnce(async (): Promise<OpenEhrResult<never>> => {
      await held.closed;
      return unreachable();
    });
    const first = runPendingResultWrites(deps);
    await vi.waitFor(() => expect(client.createContribution).toHaveBeenCalledTimes(1));
    await due(database);
    expect(await runPendingResultWrites(deps)).toEqual({ written: 0, pending: 1 });
    held.open();
    expect(await first).toEqual({ written: 0, pending: 1 });
    expect(await writeRow(database, id)).toMatchObject({
      state: "pending",
      attempts: 1,
      last_error: "openehr:unreachable",
      pause_s: 60,
    });
  });
});
