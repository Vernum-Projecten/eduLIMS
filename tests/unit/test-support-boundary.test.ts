// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The test support code (the MLLP sender and the HL7 fixture builder of #159) stays out of the
// application: no module under src/ imports anything from tests/.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const SOURCE = /\.(ts|tsx|mts|cts|js|jsx)$/;
// Static imports and re-exports, dynamic import() and require() with a string specifier.
const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["'`]([^"'`]+)["'`]/g;

/** Returns every source file under `dir`, as a path relative to the repository root. */
function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" })
    .filter((path) => SOURCE.test(path))
    .map((path) => join(dir, path));
}

/** Returns the import specifiers of a source file that point into tests/. */
function testImports(path: string): string[] {
  const code = readFileSync(join(ROOT, path), "utf8");
  return [...code.matchAll(SPECIFIER)]
    .map((match) => match[1] ?? "")
    .filter((specifier) => /(^|\/)tests\//.test(specifier));
}

describe("the boundary between the application and the test support (#159)", () => {
  it("finds the application sources to check", () => {
    expect(sourceFiles("src").length).toBeGreaterThan(10);
  });

  it("has no module under src/ that imports from tests/", () => {
    const offenders = sourceFiles("src").flatMap((path) =>
      testImports(path).map((specifier) => `${path}: ${specifier}`),
    );
    expect(offenders).toEqual([]);
  });

  it("recognises an import into tests/ when one is written", () => {
    const code = 'import { sendMllp } from "../../tests/integration/mllp-sender.ts";';
    expect([...code.matchAll(SPECIFIER)].map((match) => match[1])).toEqual([
      "../../tests/integration/mllp-sender.ts",
    ]);
  });
});
