// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Every server function of tolerances puts its app role first and its Zod validator after it
// (E1, A01): the student's page and set require the student, the teacher's view the teacher.
// The guard is tested in src/server/middleware.test.ts; the service refuses every other caller
// in its own tests.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync("src/server/tolerances/functions.ts", "utf8");

function serverFunctions(source: string): [string, string][] {
  return [...source.matchAll(/export const (\w+) = createServerFn\(([\s\S]*?)\.handler\(/g)].map(
    (match) => [match[1] ?? "", match[2] ?? ""],
  );
}

const ROLE: Record<string, { role: string; method: string }> = {
  getMyTolerancesFn: { role: "student", method: "GET" },
  setToleranceFn: { role: "student", method: "POST" },
  getLabTolerancesFn: { role: "teacher", method: "GET" },
};

describe("the tolerance server functions (E1, S10)", () => {
  it("binds the student's and the teacher's role aliases and no other", () => {
    expect(SOURCE).toContain('const teacher = requireRole("teacher");');
    expect(SOURCE).toContain('const student = requireRole("student");');
    expect(SOURCE.match(/requireRole\(/g)).toHaveLength(2);
  });

  it("finds every function", () => {
    expect(serverFunctions(SOURCE).map(([name]) => name)).toEqual(Object.keys(ROLE));
  });

  it.each(serverFunctions(SOURCE))("%s requires its role before its validator", (name, chain) => {
    const guard = chain.indexOf(`.middleware([${ROLE[name]?.role}])`);
    expect(guard).toBeGreaterThan(-1);
    expect(chain.indexOf(".validator(")).toBeGreaterThan(guard);
  });

  it.each(serverFunctions(SOURCE))("%s reads with GET or writes with POST", (name, chain) => {
    expect(chain.startsWith(`{ method: "${ROLE[name]?.method}" })`)).toBe(true);
  });
});
