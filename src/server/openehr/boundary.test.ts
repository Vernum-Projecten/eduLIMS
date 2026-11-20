// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The client is the only FerroEHR code (#145, integration.md): no other module reads a FerroEHR
// setting or names an openEHR REST path, so none can build a FerroEHR request.
import { sep } from "node:path";
import { describe, expect, it } from "vitest";
import { handWrittenFiles, handWrittenSources } from "../test-source-files.ts";

/**
 * Every hand-written TypeScript source under `src/`, tests and generated files excluded. A
 * listing from git and biome.json replaces a walk of the tree (#249, #320).
 */
function sources(): string[] {
  return handWrittenFiles("src").filter(
    (path) => /\.(ts|tsx)$/.test(path) && !/\.test\.tsx?$/.test(path),
  );
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
  it("leaves FerroEHR settings and openEHR paths to src/server/openehr/ and env.ts", async () => {
    const checked = new Set(
      sources().filter((path) => !ALLOWED.some((allowed) => path.startsWith(allowed))),
    );
    const texts = await handWrittenSources("src");
    const offenders = [...texts]
      .filter(([path, text]) => checked.has(path) && FERROEHR_REQUEST.test(text))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("would catch a module that reads FERROEHR_BASE_URL", () => {
    expect(FERROEHR_REQUEST.test("new URL(env.FERROEHR_BASE_URL)")).toBe(true);
    expect(FERROEHR_REQUEST.test('fetch(base + "/definition/template/adl1.4")')).toBe(true);
  });

  it("checks the hand-written sources and skips tests and generated files (#249)", () => {
    const listed = sources();
    expect(listed).toContain(`src${sep}server${sep}openehr${sep}client.ts`);
    expect(listed).toContain(`src${sep}server${sep}env.ts`);
    expect(listed).toContain(`src${sep}router.tsx`);
    expect(listed).not.toContain(`src${sep}server${sep}openehr${sep}boundary.test.ts`);
    expect(listed).not.toContain(`src${sep}routeTree.gen.ts`);
    expect(listed.filter((path) => path.startsWith(`src${sep}i18n${sep}`))).toEqual([]);
  });
});
