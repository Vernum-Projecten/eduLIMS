// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Every server function of a team's records puts its role first and its Zod validator after it
// (E1, A01): the student's functions the app role student, the correction log the app role
// teacher. The guard is tested in src/server/middleware.test.ts; the services refuse every other
// caller in their own tests.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync("src/server/lab-records/functions.ts", "utf8");

function serverFunctions(source: string): [string, string][] {
  return [...source.matchAll(/export const (\w+) = createServerFn\(([\s\S]*?)\.handler\(/g)].map(
    (match) => [match[1] ?? "", match[2] ?? ""],
  );
}

const READS = new Set(["getLabRecordsFn", "getRequestableTestsFn", "getCorrectionLogFn"]);
const TEACHER = new Set(["getCorrectionLogFn"]);
/** The one read without input: the catalogue's active tests, the same for every lab. */
const NO_INPUT = new Set(["getRequestableTestsFn"]);

describe("the records server functions (E1, S10)", () => {
  it("binds the student's and the teacher's role aliases, and no other", () => {
    expect(SOURCE).toContain('const student = requireRole("student");');
    expect(SOURCE).toContain('const teacher = requireRole("teacher");');
    expect(SOURCE.match(/requireRole\(/g)).toHaveLength(2);
  });

  it("finds every function", () => {
    expect(serverFunctions(SOURCE).map(([name]) => name)).toEqual([
      "getLabRecordsFn",
      "getRequestableTestsFn",
      "registerPatientFn",
      "correctPatientFn",
      "recordRequestFn",
      "correctRequestFn",
      "getCorrectionLogFn",
    ]);
  });

  it.each(serverFunctions(SOURCE))("%s requires its role before its validator", (name, chain) => {
    const alias = TEACHER.has(name) ? "teacher" : "student";
    const guard = chain.indexOf(`.middleware([${alias}])`);
    expect(guard).toBeGreaterThan(-1);
    if (NO_INPUT.has(name)) {
      expect(chain).not.toContain(".validator(");
    } else {
      expect(chain.indexOf(".validator(")).toBeGreaterThan(guard);
    }
  });

  it.each(serverFunctions(SOURCE))("%s reads with GET or writes with POST", (name, chain) => {
    const method = chain.startsWith('{ method: "GET" })') ? "GET" : "POST";
    expect(method).toBe(READS.has(name) ? "GET" : "POST");
  });

  it("takes no time from the client: no input schema names a time (Q-SIM-2)", () => {
    const schemas = readFileSync("src/server/lab-records/schemas.ts", "utf8");
    expect(schemas).not.toMatch(/entered|enteredAt|_at\b|Date\(/);
  });
});
