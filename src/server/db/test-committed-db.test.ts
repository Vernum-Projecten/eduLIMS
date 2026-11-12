// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { sql } from "kysely";
import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import { createCommittedTestDb } from "./test-committed-db.ts";

describe("createCommittedTestDb (#49, CI failure on #119)", () => {
  it("closes every pool client before the drop, so none is cut off with 57P01", async () => {
    const committed = await createCommittedTestDb(5);
    let connected = 0;
    let ended = 0;
    const errors: unknown[] = [];
    committed.pool.on("connect", (client: Client) => {
      connected += 1;
      client.on("error", (error) => errors.push(error));
      client.once("end", () => {
        ended += 1;
      });
    });
    await Promise.all(
      Array.from({ length: 10 }, () => sql`select pg_sleep(0.02)`.execute(committed.db)),
    );
    expect(connected).toBeGreaterThan(1);
    await committed.destroy();
    expect(ended).toBe(connected);
    expect(errors).toEqual([]);
  }, 60_000);
});
