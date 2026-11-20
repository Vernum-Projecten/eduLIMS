// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { newRunId } from "../../src/server/db/test-run-database.ts";
import {
  RUN_PORT_RANGE,
  removeStaleOutputDirs,
  runOutputDir,
  runPortCandidates,
} from "../e2e/run-env.ts";

// Each e2e run picks its own port (#69, #321); a hard-coded one misses the app in a parallel run.
const E2E_DIR = new URL("../e2e/", import.meta.url);

describe("e2e specs", () => {
  it("build app URLs with appUrl(), never a fixed localhost port", () => {
    const offenders = readdirSync(E2E_DIR)
      .filter((name) => name.endsWith(".ts") && name !== "run-env.ts")
      .filter((name) => /localhost:\d+/.test(readFileSync(new URL(name, E2E_DIR), "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("the ports of an e2e run (#321)", () => {
  it("derives the same ports from the same run id and name", () => {
    expect(runPortCandidates("abc_123456", "EDULIMS_E2E_PORT")).toEqual(
      runPortCandidates("abc_123456", "EDULIMS_E2E_PORT"),
    );
  });

  it("starts two runs, and two names of one run, on different ports", () => {
    const first = (id: string, name: string) => runPortCandidates(id, name).at(0);
    expect(first("abc_123456", "EDULIMS_E2E_PORT")).not.toBe(
      first("abc_654321", "EDULIMS_E2E_PORT"),
    );
    expect(first("abc_123456", "EDULIMS_E2E_PORT")).not.toBe(
      first("abc_123456", "EDULIMS_E2E_INTEGRATIONS_PORT"),
    );
  });

  it("stays below every ephemeral port range, so no outgoing connection takes a run's port", () => {
    for (const id of ["abc_000000", "abc_ffffff", "zzzzzz_0a1b2c"]) {
      for (const port of runPortCandidates(id, "EDULIMS_E2E_PORT", 200)) {
        expect(port).toBeGreaterThanOrEqual(RUN_PORT_RANGE.first);
        expect(port).toBeLessThan(RUN_PORT_RANGE.first + RUN_PORT_RANGE.count);
        expect(port).toBeLessThan(32_768);
      }
    }
  });
});

describe("the output folder of an e2e run (#321)", () => {
  it("is a folder of its own under test-results, named after the run id", () => {
    expect(runOutputDir()).toMatch(/^test-results[/\\]run_[0-9a-z]{1,10}_[0-9a-f]{6}$/);
  });

  it("removes the folders of runs older than six hours and keeps the others", async () => {
    const root = mkdtempSync(join(tmpdir(), "edulims-e2e-output-"));
    try {
      const now = new Date("2026-11-20T12:00:00Z");
      const old = `run_${newRunId(new Date("2026-11-20T05:00:00Z"))}`;
      const recent = `run_${newRunId(new Date("2026-11-20T11:00:00Z"))}`;
      for (const name of [old, recent, "other-folder"]) mkdirSync(join(root, name));
      await removeStaleOutputDirs(root, now);
      expect(readdirSync(root).sort()).toEqual(["other-folder", recent].sort());
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does nothing when no output folder exists yet", async () => {
    const missing = join(tmpdir(), `edulims-no-such-folder-${newRunId()}`);
    await expect(removeStaleOutputDirs(missing)).resolves.toBeUndefined();
  });
});
