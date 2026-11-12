// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Every server function of the administrator's class screens puts the admin role first (#37,
// A01), inline or through a local alias of `requireRole("admin")`. The guard itself is tested in
// src/server/middleware.test.ts; the service refuses a student and a teacher with 403 in
// admin.test.ts and admin-queries.test.ts.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync("src/server/classes/admin-functions.ts", "utf8");

/** The local names bound to `requireRole("admin")`, such as `const admin = …`. */
function adminAliases(source: string): string[] {
  return [...source.matchAll(/const (\w+) = requireRole\("admin"\);/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

/** Splits a module into its `createServerFn(…)` chains, up to the handler. */
function serverFunctions(source: string): string[] {
  return source
    .split("createServerFn(")
    .slice(1)
    .map((chain) => chain.slice(0, chain.indexOf(".handler(")));
}

/** Returns where a chain's admin guard starts, inline or through an alias, or -1. */
function guardIndex(chain: string, aliases: readonly string[]): number {
  const guards = [
    '.middleware([requireRole("admin")])',
    ...aliases.map((a) => `.middleware([${a}])`),
  ];
  const found = guards.map((guard) => chain.indexOf(guard)).filter((index) => index >= 0);
  return found.length > 0 ? Math.min(...found) : -1;
}

describe("the #37 server functions require the admin role", () => {
  const aliases = adminAliases(SOURCE);
  const chains = serverFunctions(SOURCE);

  it("finds the nine functions and the alias", () => {
    expect(chains).toHaveLength(9);
    expect(aliases).toEqual(["admin"]);
  });

  it.each(chains.map((chain, index) => [index, chain] as const))(
    "function %i carries the admin guard before its validator",
    (_index, chain) => {
      const guard = guardIndex(chain, aliases);
      expect(guard).toBeGreaterThan(-1);
      const validator = chain.indexOf(".validator(");
      if (validator >= 0) expect(validator).toBeGreaterThan(guard);
    },
  );

  it("matches the inline guard and the alias, and nothing else", () => {
    expect(guardIndex('{ method: "GET" }).middleware([requireRole("admin")])', [])).toBe(18);
    expect(guardIndex('{ method: "GET" }).middleware([admin])', ["admin"])).toBe(18);
    expect(guardIndex('{ method: "GET" }).middleware([teacher])', ["admin"])).toBe(-1);
    expect(guardIndex('{ method: "GET" }).middleware([requireRole("teacher")])', [])).toBe(-1);
  });

  it("reads with GET and writes with POST", () => {
    const methods = chains.map((chain) =>
      chain.startsWith('{ method: "GET" })') ? "GET" : "POST",
    );
    expect(methods.filter((method) => method === "GET")).toHaveLength(3);
  });
});
