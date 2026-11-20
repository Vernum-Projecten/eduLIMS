// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Every server function of simulations and labs puts its role first, through one of the three
// local aliases of `requireRole`, and its Zod validator after it (E1, A01). The guard itself is
// tested in src/server/middleware.test.ts; the service refuses the other roles in its own tests.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync("src/server/simulations/functions.ts", "utf8");

/** Splits a module into its exported `createServerFn(…)` chains, by name, up to the handler. */
function serverFunctions(source: string): [string, string][] {
  return [...source.matchAll(/export const (\w+) = createServerFn\(([\s\S]*?)\.handler\(/g)].map(
    (match) => [match[1] ?? "", match[2] ?? ""],
  );
}

const ROLE_OF: Record<string, "teacher" | "student" | "admin"> = {
  listMySimulations: "teacher",
  getSimulationPage: "teacher",
  getLabPage: "teacher",
  createSimulationFn: "teacher",
  renameSimulationFn: "teacher",
  deleteSimulationFn: "teacher",
  addTeacherFn: "teacher",
  removeTeacherFn: "teacher",
  createLabFn: "teacher",
  renameLabFn: "teacher",
  deleteLabFn: "teacher",
  moveMemberFn: "teacher",
  removeMemberFn: "teacher",
  previewEmailsFn: "teacher",
  addEmailsFn: "teacher",
  removeEmailFn: "teacher",
  getJoinCodeFn: "teacher",
  enableJoinCodeFn: "teacher",
  regenerateJoinCodeFn: "teacher",
  disableJoinCodeFn: "teacher",
  uploadLabLogoFn: "teacher",
  removeLabLogoFn: "teacher",
  joinLabFn: "student",
  getMyLabs: "student",
  linkMyLabsFn: "student",
  listAdminSimulationsFn: "admin",
  getAdminSimulationFn: "admin",
};

/** The functions that take no input: they read the session user's own rows only. */
const NO_INPUT = new Set(["listMySimulations", "getMyLabs", "linkMyLabsFn"]);

const READS = new Set([
  "listMySimulations",
  "getSimulationPage",
  "getLabPage",
  "getJoinCodeFn",
  "getMyLabs",
  "listAdminSimulationsFn",
  "getAdminSimulationFn",
]);

describe("the simulation server functions (E1)", () => {
  const chains = serverFunctions(SOURCE);

  it("binds the three role aliases to the roles they name", () => {
    expect(SOURCE).toContain('const teacher = requireRole("teacher");');
    expect(SOURCE).toContain('const student = requireRole("student");');
    expect(SOURCE).toContain('const admin = requireRole("admin");');
  });

  it("finds every function, and no other", () => {
    expect(chains.map(([name]) => name).sort()).toEqual(Object.keys(ROLE_OF).sort());
  });

  it.each(serverFunctions(SOURCE))("%s requires its role before its validator", (name, chain) => {
    const guard = chain.indexOf(`.middleware([${ROLE_OF[name]}])`);
    expect(guard).toBeGreaterThan(-1);
    const validator = chain.indexOf(".validator(");
    if (NO_INPUT.has(name)) expect(validator).toBe(-1);
    else expect(validator).toBeGreaterThan(guard);
  });

  it.each(serverFunctions(SOURCE))("%s reads with GET or writes with POST", (name, chain) => {
    const method = chain.startsWith('{ method: "GET" })') ? "GET" : "POST";
    expect(method).toBe(READS.has(name) ? "GET" : "POST");
  });
});
