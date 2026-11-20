// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The file listing of the source boundary tests (#145, #159, #320). It asks the tooling which
// files are generated instead of keeping a list here: git leaves out what `.gitignore` ignores
// (the Paraglide output under src/i18n carries its own), and Biome's `files.includes` names the
// tracked generated files (the route tree, the Kysely types).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
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

/** Returns the hand-written files under `dir` relative to the root, with `/`. */
function handWritten(dir: string): string[] {
  const excludes = biomeExcludes(readFileSync(join(ROOT, "biome.json"), "utf8"));
  const deleted = new Set(gitFiles(dir, "--deleted"));
  const listed = new Set(gitFiles(dir, "--cached", "--others", "--exclude-standard"));
  return [...listed].filter((path) => !deleted.has(path) && !isExcluded(path, excludes));
}

/** Returns `path` (relative to the root, with `/`) in this OS's form. */
function osPath(path: string): string {
  return path.split("/").join(sep);
}

/**
 * Returns the hand-written files under `dir` as paths relative to the root in this OS's form:
 * the tracked and the new files git sees, less those deleted from the working tree, those
 * `.gitignore` ignores and those Biome leaves out. Tests stay in; a caller filters them.
 */
export function handWrittenFiles(dir: string): string[] {
  return handWritten(dir).map(osPath);
}

/**
 * Parses the output of `git cat-file --batch` for `requests`, in order: the content of each
 * object found, or `undefined` for one git reports missing.
 */
export function parseCatFileBatch(out: Buffer, requests: number): (string | undefined)[] {
  const contents: (string | undefined)[] = [];
  let offset = 0;
  for (let index = 0; index < requests; index += 1) {
    const end = out.indexOf(0x0a, offset);
    if (end < 0) throw new Error("git cat-file --batch ended early.");
    const header = out.toString("utf8", offset, end);
    offset = end + 1;
    const size = /^[0-9a-f]+ blob (\d+)$/.exec(header)?.[1];
    if (size === undefined) {
      if (!header.endsWith(" missing")) throw new Error(`git cat-file --batch said "${header}".`);
      contents.push(undefined);
      continue;
    }
    contents.push(out.toString("utf8", offset, offset + Number(size)));
    offset += Number(size) + 1;
  }
  return contents;
}

/**
 * Returns the text of every file {@link handWrittenFiles} lists, keyed by the same path. A file
 * the working tree holds as git stores it is read from git's object store in one call; only new
 * and changed files are opened, since opening 600 files one by one took 2 to 15 s on a loaded
 * host where the object store took under 1 s (#320).
 */
export async function handWrittenSources(dir: string): Promise<Map<string, string>> {
  const paths = handWritten(dir);
  const changed = new Set([
    ...gitFiles(dir, "--modified"),
    ...gitFiles(dir, "--others", "--exclude-standard"),
  ]);
  const stored = paths.filter((path) => !changed.has(path));
  const out = execFileSync("git", ["cat-file", "--batch"], {
    cwd: ROOT,
    input: stored.map((path) => `:${path}\n`).join(""),
    maxBuffer: 512 * 1024 * 1024,
  });
  const blobs = parseCatFileBatch(out, stored.length);
  const texts = new Map<string, string>();
  stored.forEach((path, index) => {
    const blob = blobs[index];
    if (blob !== undefined) texts.set(path, blob);
  });
  const fromDisk = await Promise.all(
    paths
      .filter((path) => !texts.has(path))
      .map(async (path) => [path, await readFile(join(ROOT, path), "utf8")] as const),
  );
  for (const [path, text] of fromDisk) texts.set(path, text);
  return new Map([...texts].map(([path, text]) => [osPath(path), text]));
}
