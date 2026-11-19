// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RUN_PORT_RANGE, runPortCandidates } from "../e2e/run-env.ts";

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
