// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Each e2e run picks a free port (#69); a hard-coded one misses the app in a parallel run.
const E2E_DIR = new URL("../e2e/", import.meta.url);

describe("e2e specs", () => {
  it("build app URLs with appUrl(), never a fixed localhost port", () => {
    const offenders = readdirSync(E2E_DIR)
      .filter((name) => name.endsWith(".ts") && name !== "run-env.ts")
      .filter((name) => /localhost:\d+/.test(readFileSync(new URL(name, E2E_DIR), "utf8")));
    expect(offenders).toEqual([]);
  });
});
