// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  databaseOf,
  newRunId,
  runDatabaseCreatedAt,
  runDatabaseName,
  STALE_RUN_DATABASE_MS,
  staleRunDatabases,
  withDatabase,
} from "./test-run-database.ts";

const NOW = new Date("2026-11-11T12:00:00Z");
const HOUR = 60 * 60 * 1000;

describe("run database names (#69)", () => {
  it("names the run database after the base and the run id", () => {
    const id = newRunId(NOW);
    expect(id).toMatch(/^[0-9a-z]+_[0-9a-f]{6}$/);
    expect(runDatabaseName("edulims_test", id)).toBe(`edulims_test_${id}`);
  });

  it("gives two runs in the same second different ids", () => {
    expect(newRunId(NOW)).not.toBe(newRunId(NOW));
  });

  it("refuses a run id it did not make", () => {
    expect(() => runDatabaseName("edulims_test", "x; drop")).toThrow(/not a test run id/);
  });

  it("reads the creation time back from the name, to the second", () => {
    const name = runDatabaseName("edulims_test", newRunId(NOW));
    expect(runDatabaseCreatedAt("edulims_test", name)).toEqual(NOW);
  });

  it.each([
    "edulims_test",
    "edulims_e2e_mhv1abc_0a1b2c",
    "edulims_sso_test",
    "edulims_test_feature",
    "edulims_test_mhv1abc_0a1b2c_extra",
  ])("does not take %s for a run database of edulims_test", (name) => {
    expect(runDatabaseCreatedAt("edulims_test", name)).toBeUndefined();
  });
});

describe("staleRunDatabases (#69)", () => {
  const at = (msAgo: number) =>
    runDatabaseName("edulims_test", newRunId(new Date(NOW.getTime() - msAgo)));

  it("returns the run databases older than the limit, and only those", () => {
    const old = at(STALE_RUN_DATABASE_MS + HOUR);
    const recent = at(HOUR);
    const names = [old, recent, "edulims_test", "edulims", "edulims_e2e"];
    expect(staleRunDatabases("edulims_test", names, NOW)).toEqual([old]);
  });

  it("leaves another base's run databases alone", () => {
    const other = runDatabaseName("edulims_e2e", newRunId(new Date(NOW.getTime() - 48 * HOUR)));
    expect(staleRunDatabases("edulims_test", [other], NOW)).toEqual([]);
  });
});

describe("database URLs", () => {
  const URL = "postgres://edulims:edulims@127.0.0.1:5432/edulims_test?sslmode=disable";

  it("swaps only the database, keeping server, user, password and options", () => {
    expect(withDatabase(URL, "edulims_test_abc_0a1b2c")).toBe(
      "postgres://edulims:edulims@127.0.0.1:5432/edulims_test_abc_0a1b2c?sslmode=disable",
    );
  });

  it("reads the database name", () => {
    expect(databaseOf(URL)).toBe("edulims_test");
  });

  it("refuses a URL without a database", () => {
    expect(() => databaseOf("postgres://u:p@localhost")).toThrow(/names no database/);
  });
});
