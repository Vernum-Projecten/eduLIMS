// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The client is the only FerroEHR code (#145, integration.md): no other module reads a FerroEHR
// setting or names an openEHR REST path, so none can build a FerroEHR request.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const SRC = join(ROOT, "src");
// The Paraglide output (`pnpm i18n`): over a thousand generated message modules.
const GENERATED_DIRS = [join(SRC, "i18n")];

/** Every hand-written source file under `src/`, tests and generated files excluded. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return GENERATED_DIRS.includes(path) ? [] : sources(path);
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    if (entry.name.endsWith(".gen.ts")) return [];
    return [path];
  });
}

// test-env.ts holds the unit tests' environment values; it builds no request.
const ALLOWED = [
  `src${sep}server${sep}openehr${sep}`,
  `src${sep}server${sep}env.ts`,
  `src${sep}server${sep}test-env.ts`,
];
const FERROEHR_REQUEST =
  /FERROEHR_(BASE_URL|TOKEN_URL|CLIENT_ID|CLIENT_SECRET|SCOPE)|\/openehr\/v1|definition\/template|\/query\/aql/;

describe("the openEHR client boundary (#145, Q-COMP-1)", () => {
  it("leaves FerroEHR settings and openEHR paths to src/server/openehr/ and env.ts", () => {
    const offenders = sources(SRC)
      .map((path) => relative(ROOT, path))
      .filter((path) => !ALLOWED.some((allowed) => path.startsWith(allowed)))
      .filter((path) => FERROEHR_REQUEST.test(readFileSync(join(ROOT, path), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("would catch a module that reads FERROEHR_BASE_URL", () => {
    expect(FERROEHR_REQUEST.test("new URL(env.FERROEHR_BASE_URL)")).toBe(true);
    expect(FERROEHR_REQUEST.test('fetch(base + "/definition/template/adl1.4")')).toBe(true);
  });
});
