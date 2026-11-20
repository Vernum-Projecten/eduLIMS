// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Every server function of the uploads puts the student role first and its Zod validator after
// it (E1, A01); the guard is tested in src/server/middleware.test.ts, and the service refuses
// every other caller in its own tests. The upload's own form limit is wired in src/start.ts.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync("src/server/upload/functions.ts", "utf8");
const START = readFileSync("src/start.ts", "utf8");

function serverFunctions(source: string): [string, string][] {
  return [...source.matchAll(/export const (\w+) = createServerFn\(([\s\S]*?)\.handler\(/g)].map(
    (match) => [match[1] ?? "", match[2] ?? ""],
  );
}

const METHOD: Record<string, string> = {
  uploadGen5Fn: "POST",
  linkGen5UploadFn: "POST",
  getGen5UploadFn: "GET",
};

describe("the upload server functions (E1, S10)", () => {
  it("binds the student's role alias and no other", () => {
    expect(SOURCE).toContain('const student = requireRole("student");');
    expect(SOURCE.match(/requireRole\(/g)).toHaveLength(1);
  });

  it("finds every function", () => {
    expect(serverFunctions(SOURCE).map(([name]) => name)).toEqual(Object.keys(METHOD));
  });

  it.each(serverFunctions(SOURCE))("%s requires the student before its validator", (_, chain) => {
    const guard = chain.indexOf(".middleware([student])");
    expect(guard).toBeGreaterThan(-1);
    expect(chain.indexOf(".validator(")).toBeGreaterThan(guard);
  });

  it.each(serverFunctions(SOURCE))("%s reads with GET or writes with POST", (name, chain) => {
    expect(chain.startsWith(`{ method: "${METHOD[name]}" })`)).toBe(true);
  });

  it("gives the upload's function, and only it, the Gen5 form limit (#156)", () => {
    expect(START).toContain("formBodyLimit(new URL(request.url).pathname, uploadGen5Fn.url)");
    expect(START).toContain("refuseFormBody(request, limit)");
  });
});
