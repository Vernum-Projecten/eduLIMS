// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Every server function of correct values puts the app role teacher first and its Zod validator
// after it (E1, A01), and none is open to a student (Q-SIM-1). The guard is tested in
// src/server/middleware.test.ts; the service refuses every other caller in its own tests.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync("src/server/correct-values/functions.ts", "utf8");

function serverFunctions(source: string): [string, string][] {
  return [...source.matchAll(/export const (\w+) = createServerFn\(([\s\S]*?)\.handler\(/g)].map(
    (match) => [match[1] ?? "", match[2] ?? ""],
  );
}

const READS = new Set(["getCorrectValuesFn"]);

describe("the correct-value server functions (E1, Q-SIM-1)", () => {
  it("binds one role alias, the teacher's, and no other", () => {
    expect(SOURCE).toContain('const teacher = requireRole("teacher");');
    expect(SOURCE.match(/requireRole\(/g)).toHaveLength(1);
  });

  it("finds every function", () => {
    expect(serverFunctions(SOURCE).map(([name]) => name)).toEqual([
      "getCorrectValuesFn",
      "setCorrectValuesFn",
      "removeCorrectValueFn",
      "setLimitsFn",
    ]);
  });

  it.each(serverFunctions(SOURCE))("%s requires the teacher before its validator", (_n, chain) => {
    const guard = chain.indexOf(".middleware([teacher])");
    expect(guard).toBeGreaterThan(-1);
    expect(chain.indexOf(".validator(")).toBeGreaterThan(guard);
  });

  it.each(serverFunctions(SOURCE))("%s reads with GET or writes with POST", (name, chain) => {
    const method = chain.startsWith('{ method: "GET" })') ? "GET" : "POST";
    expect(method).toBe(READS.has(name) ? "GET" : "POST");
  });
});
