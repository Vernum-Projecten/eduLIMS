// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The file listing of the source boundary tests (#145, #159, #320). It asks the tooling which
// files are generated instead of keeping a list here: git leaves out what `.gitignore` ignores
// (the Paraglide output under src/i18n carries its own), and Biome's `files.includes` names the
// tracked generated files (the route tree, the Kysely types).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, matchesGlob, sep } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");

/** Runs `git ls-files -z` on `dir` and returns the paths, relative to the root, with `/`. */
function gitFiles(dir: string, ...args: string[]): string[] {
  const out = execFileSync("git", ["ls-files", "-z", ...args, "--", dir], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return out.split("\0").filter((path) => path !== "");
}

/** Returns the patterns `biome.json` leaves out of `files.includes`, without their `!`. */
export function biomeExcludes(biomeJson: string): string[] {
  const parsed: unknown = JSON.parse(biomeJson);
  const files: unknown = typeof parsed === "object" && parsed ? Reflect.get(parsed, "files") : null;
  const includes: unknown =
    typeof files === "object" && files ? Reflect.get(files, "includes") : null;
  if (!Array.isArray(includes)) throw new Error("biome.json has no files.includes list.");
  return includes
    .filter((entry): entry is string => typeof entry === "string" && entry.startsWith("!"))
    .map((entry) => entry.replace(/^!+/, ""));
}

/**
 * Returns whether `path` (relative to the root, with `/`) falls under one of the `excludes`
 * patterns: the pattern itself, or a folder the pattern names.
 */
export function isExcluded(path: string, excludes: readonly string[]): boolean {
  return excludes.some(
    (pattern) => matchesGlob(path, pattern) || matchesGlob(path, `${pattern}/**`),
  );
}

/**
 * Returns the hand-written files under `dir` as paths relative to the root in this OS's form:
 * the tracked and the new files git sees, less those deleted from the working tree, those
 * `.gitignore` ignores and those Biome leaves out. Tests stay in; a caller filters them.
 */
export function handWrittenFiles(dir: string): string[] {
  const excludes = biomeExcludes(readFileSync(join(ROOT, "biome.json"), "utf8"));
  const deleted = new Set(gitFiles(dir, "--deleted"));
  const listed = new Set(gitFiles(dir, "--cached", "--others", "--exclude-standard"));
  return [...listed]
    .filter((path) => !deleted.has(path) && !isExcluded(path, excludes))
    .map((path) => path.split("/").join(sep));
}
