// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The test support code (the MLLP sender and the HL7 fixture builder of #159) stays out of the
// application: no module under src/ imports anything from tests/.
import { readFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { handWrittenFiles } from "../../src/server/test-source-files.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const SOURCE = /\.(ts|tsx|mts|cts|js|jsx)$/;
// Static imports and re-exports, dynamic import() and require() with a string specifier.
const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["'`]([^"'`]+)["'`]/g;

/**
 * Returns every hand-written source file under `dir`, tests included, as a path relative to the
 * repository root. Generated output (the Paraglide messages, the route tree) is left out (#320).
 */
function sourceFiles(dir: string): string[] {
  return handWrittenFiles(dir).filter((path) => SOURCE.test(path));
}

/** Returns the import specifiers in `code` that point into tests/. */
function testImports(code: string): string[] {
  return [...code.matchAll(SPECIFIER)]
    .map((match) => match[1] ?? "")
    .filter((specifier) => /(^|\/)tests\//.test(specifier));
}

describe("the boundary between the application and the test support (#159)", () => {
  it("finds the application sources to check", () => {
    expect(sourceFiles("src").length).toBeGreaterThan(10);
  });

  it("checks the hand-written sources, tests included, and skips generated output (#320)", () => {
    const listed = sourceFiles("src");
    expect(listed).toContain(`src${sep}router.tsx`);
    expect(listed).toContain(`src${sep}server${sep}openehr${sep}boundary.test.ts`);
    expect(listed).not.toContain(`src${sep}routeTree.gen.ts`);
    expect(listed).not.toContain(`src${sep}server${sep}db${sep}schema.gen.ts`);
    expect(listed.filter((path) => path.startsWith(`src${sep}i18n${sep}`))).toEqual([]);
  });

  it("has no module under src/ that imports from tests/", async () => {
    const paths = sourceFiles("src");
    const codes = await Promise.all(paths.map((path) => readFile(join(ROOT, path), "utf8")));
    const offenders = paths.flatMap((path, index) =>
      testImports(codes[index] ?? "").map((specifier) => `${path}: ${specifier}`),
    );
    expect(offenders).toEqual([]);
  });

  it("recognises an import into tests/ when one is written", () => {
    const code = 'import { sendMllp } from "../../tests/integration/mllp-sender.ts";';
    expect(testImports(code)).toEqual(["../../tests/integration/mllp-sender.ts"]);
  });
});
