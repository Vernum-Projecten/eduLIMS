// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Every server function of the test catalogue puts the role teacher first and its Zod validator
// after it (E1, A01); only the list reads with GET. The guard itself is tested in
// src/server/middleware.test.ts; the service refuses the other roles in its own tests.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync("src/server/catalogue/functions.ts", "utf8");

/** Splits a module into its exported `createServerFn(…)` chains, by name, up to the handler. */
function serverFunctions(source: string): [string, string][] {
  return [...source.matchAll(/export const (\w+) = createServerFn\(([\s\S]*?)\.handler\(/g)].map(
    (match) => [match[1] ?? "", match[2] ?? ""],
  );
}

const FUNCTIONS = [
  "listCatalogueTests",
  "createCatalogueTest",
  "updateCatalogueTest",
  "retireCatalogueTest",
  "restoreCatalogueTest",
];

describe("the catalogue server functions (E1, D9)", () => {
  const chains = serverFunctions(SOURCE);

  it("binds the role alias to the teacher role, and no other role", () => {
    expect(SOURCE).toContain('const teacher = requireRole("teacher");');
    expect(SOURCE.match(/requireRole\(/g)).toHaveLength(1);
  });

  it("finds every function, and no other", () => {
    expect(chains.map(([name]) => name).sort()).toEqual([...FUNCTIONS].sort());
  });

  it.each(chains)("%s requires the teacher role before its validator", (_name, chain) => {
    const guard = chain.indexOf(".middleware([teacher])");
    expect(guard).toBeGreaterThan(-1);
    expect(chain.indexOf(".validator(")).toBeGreaterThan(guard);
  });

  it.each(chains)("%s reads with GET or writes with POST", (name, chain) => {
    const method = chain.startsWith('{ method: "GET" })') ? "GET" : "POST";
    expect(method).toBe(name === "listCatalogueTests" ? "GET" : "POST");
  });
});
