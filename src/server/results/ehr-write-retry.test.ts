// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The retry run of the pending writes of released results on a real database with FerroEHR
// stubbed (#148, reliability.md "Idempotent writes"): it takes only due rows, leases them, keeps
// to its limit, and a retry after a lost answer finds the one composition.
import { type Kysely, sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { finalResultContributionUid } from "../openehr/contribution.ts";
import { failure } from "../openehr/errors.ts";
import { runPendingResultWrites, writeReleasedResult } from "./ehr-write.ts";
import { releaseResult } from "./release.ts";
import {
  analyserDeps,
  ferroEhr,
  input,
  released,
  unreachable,
  VERSION,
  writeRow,
} from "./test-ehr-write.ts";
import { measure, resultsWorld, toleranceFor } from "./test-helpers.ts";

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

describe("runPendingResultWrites (the retry schedule, #148)", () => {
  async function due(database: Kysely<DB>) {
    await database
      .updateTable("result_ehr_writes")
      .set({ next_attempt_at: sql`now() - interval '1 second'` })
      .execute();
  }

  it("takes no write whose pause is not over", async () => {
    const { database, w } = await open();
    await released(database, w);
    const { client } = ferroEhr();
    expect(await runPendingResultWrites(analyserDeps(database, client))).toEqual({
      written: 0,
      pending: 0,
    });
    expect(client.createContribution).not.toHaveBeenCalled();
  });

  it("finds a write whose commit landed before a timeout: still one composition", async () => {
    const { database, w } = await open();
    const id = await released(database, w);
    const { client, stored } = ferroEhr();
    client.createContribution.mockImplementationOnce(async (_, body) => {
      stored.set(body.uid.value, body);
      return failure({
        kind: "timeout",
        target: "ferroehr",
        cause: new DOMException("t", "TimeoutError"),
      });
    });
    const deps = analyserDeps(database, client);
    expect(await writeReleasedResult(deps, id)).toBe("pending");
    await due(database);
    expect(await runPendingResultWrites(deps)).toEqual({ written: 1, pending: 0 });
    expect(stored.size).toBe(1);
    expect(client.getContribution).toHaveBeenCalledWith(w.ehrId, finalResultContributionUid(id));
    expect((await writeRow(database, id)).version_uid).toBe(VERSION);
  });

  it("leases what it takes, so a second run at once takes nothing", async () => {
    const { database, w } = await open();
    await released(database, w);
    await due(database);
    const { client } = ferroEhr();
    client.createContribution.mockImplementation(async () => unreachable());
    const deps = analyserDeps(database, client);
    expect(await runPendingResultWrites(deps)).toEqual({ written: 0, pending: 1 });
    expect(await runPendingResultWrites(deps)).toEqual({ written: 0, pending: 0 });
  });

  it("takes at most its limit", async () => {
    const { database, w } = await open();
    await released(database, w);
    const crp = await measure(database, w, "12", { testId: w.crp });
    const crpTolerance = await toleranceFor(database, w.student, w.labId, w.crp, "0", "20");
    const second = await releaseResult(database, w.student, {
      ...input(w, crp),
      testId: w.crp,
      toleranceId: crpTolerance,
    });
    expect(second).toMatchObject({ ok: true });
    await due(database);
    const deps = analyserDeps(database, ferroEhr().client);
    expect(await runPendingResultWrites(deps, 1)).toEqual({ written: 1, pending: 0 });
    expect(await runPendingResultWrites(deps, 1)).toEqual({ written: 1, pending: 0 });
  });
});
