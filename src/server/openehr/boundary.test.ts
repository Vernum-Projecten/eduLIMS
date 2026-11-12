// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The client is the only FerroEHR code (#145, integration.md): no other module reads a FerroEHR
// setting or names an openEHR REST path, so none can build a FerroEHR request.
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..", "..");
// The Paraglide output (`pnpm i18n`): over a thousand generated message modules.
const GENERATED_DIRS = [`src${sep}i18n${sep}`];

/** Runs `git ls-files -z` on `src/` and returns the paths, relative to the root, in this OS's form. */
function gitFiles(...args: string[]): string[] {
  const out = execFileSync("git", ["ls-files", "-z", ...args, "--", "src"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return out
    .split("\0")
    .filter((path) => path !== "")
    .map((path) => path.split("/").join(sep));
}

/**
 * Every hand-written TypeScript source under `src/`, tests and generated files excluded: the
 * tracked and the new files git sees, less those deleted from the working tree. A listing from
 * git replaces a walk of the tree, so only these files are opened (#249).
 */
function sources(): string[] {
  const deleted = new Set(gitFiles("--deleted"));
  const listed = new Set(gitFiles("--cached", "--others", "--exclude-standard"));
  return [...listed].filter(
    (path) =>
      !deleted.has(path) &&
      !GENERATED_DIRS.some((dir) => path.startsWith(dir)) &&
      /\.(ts|tsx)$/.test(path) &&
      !/\.test\.tsx?$/.test(path) &&
      !path.endsWith(".gen.ts"),
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
    const candidates = sources().filter(
      (path) => !ALLOWED.some((allowed) => path.startsWith(allowed)),
    );
    const texts = await Promise.all(candidates.map((path) => readFile(join(ROOT, path), "utf8")));
    const offenders = candidates.filter((_, index) => FERROEHR_REQUEST.test(texts[index] ?? ""));
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
