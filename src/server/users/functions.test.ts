// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Every server function of the Users screen puts the admin role first and its Zod validator after
// it (E1, A01). The guard itself is tested in src/server/middleware.test.ts (401 without a
// session, 403 without the role); the actions refuse a teacher and a student in their own tests.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync("src/server/users/functions.ts", "utf8");

/** Splits a module into its exported `createServerFn(…)` chains, by name, up to the handler. */
function serverFunctions(source: string): [string, string][] {
  return [...source.matchAll(/export const (\w+) = createServerFn\(([\s\S]*?)\.handler\(/g)].map(
    (match) => [match[1] ?? "", match[2] ?? ""],
  );
}

const READS = new Set(["listAdminUsers", "getAdminUser"]);

describe("the Users screen's server functions (E1, B1)", () => {
  const chains = serverFunctions(SOURCE);

  it("include the deletion of a user (#318)", () => {
    expect(chains.map(([name]) => name)).toContain("deleteAdminUser");
  });

  it.each(chains)("%s requires the admin role before its validator", (_name, chain) => {
    const guard = chain.indexOf('.middleware([requireRole("admin")])');
    expect(guard).toBeGreaterThan(-1);
    expect(chain.indexOf(".validator(")).toBeGreaterThan(guard);
  });

  it.each(chains)("%s reads with GET or writes with POST", (name, chain) => {
    const method = chain.startsWith('{ method: "GET" })') ? "GET" : "POST";
    expect(method).toBe(READS.has(name) ? "GET" : "POST");
  });
});
