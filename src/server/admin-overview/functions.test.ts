// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Every server function of the overview and the system page puts the admin role first (#36,
// A01). The guard itself is tested in src/server/middleware.test.ts; the reads refuse a student
// and a teacher with 403 in their own tests.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FILES = ["src/server/admin-overview/functions.ts", "src/server/system/functions.ts"];

/** Splits a module into its `createServerFn(…)` chains, up to the handler. */
function serverFunctions(source: string): string[] {
  return source
    .split("createServerFn(")
    .slice(1)
    .map((chain) => chain.slice(0, chain.indexOf(".handler(")));
}

describe("the #36 server functions require the admin role", () => {
  it.each(FILES)('%s: every function is a GET with requireRole("admin") first', (file) => {
    const chains = serverFunctions(readFileSync(file, "utf8"));
    expect(chains.length).toBeGreaterThan(0);
    for (const chain of chains) {
      expect(chain.startsWith('{ method: "GET" })')).toBe(true);
      const guard = chain.indexOf('.middleware([requireRole("admin")])');
      expect(guard).toBeGreaterThan(-1);
      expect(chain.indexOf(".validator(")).toBeGreaterThan(guard);
    }
  });
});
