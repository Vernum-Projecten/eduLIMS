// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Every server function of the test catalogue puts its role first and its Zod validator after it
// (E1, A01): the admin role for the catalogue itself, the teacher role for the read of the
// active tests only (owner 2026-11-20, #393). Only the reads use GET. The guard itself is tested
// in src/server/middleware.test.ts; the service refuses the other roles in its own tests.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync("src/server/catalogue/functions.ts", "utf8");

/** Splits a module into its exported `createServerFn(…)` chains, by name, up to the handler. */
function serverFunctions(source: string): [string, string][] {
  return [...source.matchAll(/export const (\w+) = createServerFn\(([\s\S]*?)\.handler\(/g)].map(
    (match) => [match[1] ?? "", match[2] ?? ""],
  );
}

const ADMIN_FUNCTIONS = [
  "listCatalogueTests",
  "createCatalogueTest",
  "updateCatalogueTest",
  "retireCatalogueTest",
  "restoreCatalogueTest",
];
const TEACHER_FUNCTIONS = ["listActiveCatalogueTests"];
const READS = ["listCatalogueTests", "listActiveCatalogueTests"];

describe("the catalogue server functions (E1, D9, #393)", () => {
  const chains = serverFunctions(SOURCE);

  it("binds the role aliases to the admin and teacher roles, and no other role", () => {
    expect(SOURCE).toContain('const admin = requireRole("admin");');
    expect(SOURCE).toContain('const teacher = requireRole("teacher");');
    expect(SOURCE.match(/requireRole\(/g)).toHaveLength(2);
  });

  it("finds every function, and no other", () => {
    expect(chains.map(([name]) => name).sort()).toEqual(
      [...ADMIN_FUNCTIONS, ...TEACHER_FUNCTIONS].sort(),
    );
  });

  it.each(chains)("%s requires its role before its validator", (name, chain) => {
    const role = TEACHER_FUNCTIONS.includes(name) ? "teacher" : "admin";
    const guard = chain.indexOf(`.middleware([${role}])`);
    expect(guard).toBeGreaterThan(-1);
    expect(chain.match(/\.middleware\(/g)).toHaveLength(1);
    expect(chain.indexOf(".validator(")).toBeGreaterThan(guard);
  });

  it.each(chains)("%s reads with GET or writes with POST", (name, chain) => {
    const method = chain.startsWith('{ method: "GET" })') ? "GET" : "POST";
    expect(method).toBe(READS.includes(name) ? "GET" : "POST");
  });
});
