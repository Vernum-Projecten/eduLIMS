// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// A seeded, deterministic mutation test of the Gen5 parser (a condition of the security review
// of #297 for the hand-written readers): every mutant of a good file gives a typed refusal or a
// valid plate, never a throw, and the run stays inside its time budget. A failure prints its seed;
// replay it alone with `GEN5_MUTATION_SEED='<seed>' pnpm exec vitest run gen5-mutation`.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type Gen5ParseResult, parseGen5Export } from "../../src/server/upload/gen5.ts";
import { readZipDirectory, readZipEntry } from "../../src/server/upload/zip.ts";
import { buildZip, type ZipPart } from "../fixtures/gen5/xlsx-builder.ts";

const FIXTURES = ["epoch2-endpoint-750nm-air.xlsx", "epoch2-endpoint-450nm-gradient.xlsx"];
const CONTAINER_MUTANTS = 1_500;
const XML_MUTANTS = 750;
/** The whole run's budget: about 6,000 parses of small files, with room for a slow CI runner. */
const BUDGET_MS = 60_000;
const XML_PARTS = new Set([
  "[Content_Types].xml",
  "_rels/.rels",
  "xl/workbook.xml",
  "xl/_rels/workbook.xml.rels",
  "xl/sharedStrings.xml",
  "xl/worksheets/sheet1.xml",
]);

/** A deterministic stream of integers from SHA-256 of the seed and a counter. */
function random(seed: string): (below: number) => number {
  let counter = 0;
  let pool = Buffer.alloc(0);
  let position = 0;
  return (below) => {
    if (position + 4 > pool.length) {
      pool = createHash("sha256").update(`${seed}:${counter}`).digest();
      counter += 1;
      position = 0;
    }
    const value = pool.readUInt32LE(position);
    position += 4;
    return value % below;
  };
}

/** Applies one to three flips, inserts, deletes, overwrites or a truncation to `bytes`. */
function mutate(bytes: Uint8Array, next: (below: number) => number): Uint8Array {
  let out = Array.from(bytes);
  const operations = 1 + next(3);
  for (let step = 0; step < operations && out.length > 0; step += 1) {
    const at = next(out.length);
    switch (next(5)) {
      case 0:
        out[at] = (out[at] ?? 0) ^ (1 << next(8));
        break;
      case 1:
        out.splice(at, 0, next(256));
        break;
      case 2:
        out.splice(at, 1 + next(4));
        break;
      case 3:
        out[at] = next(256);
        break;
      default:
        out = out.slice(0, at);
    }
  }
  return new Uint8Array(out);
}

const cache = new Map<string, Uint8Array>();

function fixtureBytes(name: string): Uint8Array {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;
  const bytes = new Uint8Array(readFileSync(new URL(`../fixtures/gen5/${name}`, import.meta.url)));
  cache.set(name, bytes);
  return bytes;
}

/** The entries of a good fixture, unpacked, so one XML part can be mutated and re-packed. */
function unpackedParts(bytes: Uint8Array): ZipPart[] {
  const zip = readZipDirectory(bytes, { maxEntries: 50, maxUnpackedBytes: 1 << 23 });
  if (!zip.ok) throw new Error(JSON.stringify(zip.error));
  return [...zip.value.entries.values()].map((entry) => {
    const data = readZipEntry(zip.value, entry, 1 << 20);
    if (!data.ok) throw new Error(JSON.stringify(data.error));
    return { name: entry.name, data: data.value };
  });
}

/** Rebuilds the mutant a seed names, for a replay. */
function mutant(seed: string): Uint8Array {
  const [fixture = "", kind, index] = seed.split("|");
  const next = random(seed);
  const bytes = fixtureBytes(fixture);
  if (kind === "container" || index === undefined) return mutate(bytes, next);
  const parts = unpackedParts(bytes);
  const xml = parts.filter((part) => XML_PARTS.has(part.name));
  const target = xml[next(xml.length)];
  return buildZip(
    parts.map((part) =>
      part === target && typeof part.data !== "string"
        ? { ...part, data: mutate(part.data, next) }
        : part,
    ),
  );
}

/** Returns a description of what is wrong with a result, or `undefined` when it is valid. */
function invalid(result: Gen5ParseResult): string | undefined {
  if (result.ok) return result.plate.wells.length === 96 ? undefined : "a plate without 96 wells";
  if (result.errors.length === 0) return "a refusal without an error";
  return result.errors.every((error) => typeof error.kind === "string")
    ? undefined
    : "an error without a kind";
}

const REPLAY = process.env["GEN5_MUTATION_SEED"];
const SEEDS: readonly string[] =
  REPLAY !== undefined
    ? [REPLAY]
    : FIXTURES.flatMap((fixture) => [
        ...Array.from({ length: CONTAINER_MUTANTS }, (_, index) => `${fixture}|container|${index}`),
        ...Array.from({ length: XML_MUTANTS }, (_, index) => `${fixture}|xml|${index}`),
      ]);

describe("the parser under mutation", () => {
  it("runs every seed unless one is replayed", () => {
    expect(SEEDS).toHaveLength(
      REPLAY === undefined ? FIXTURES.length * (CONTAINER_MUTANTS + XML_MUTANTS) : 1,
    );
  });

  it(
    "gives a typed refusal or a valid plate for every mutant, within the budget",
    () => {
      const started = performance.now();
      const failures: string[] = [];
      const seeds = SEEDS;
      for (const seed of seeds) {
        try {
          const problem = invalid(parseGen5Export({ fileName: "plate.xlsx", bytes: mutant(seed) }));
          if (problem !== undefined) failures.push(`${seed}: ${problem}`);
        } catch (error) {
          failures.push(`${seed}: threw ${String(error)}`);
        }
      }
      const elapsed = performance.now() - started;
      expect(failures).toEqual([]);
      expect(elapsed).toBeLessThan(BUDGET_MS);
    },
    BUDGET_MS * 2,
  );

  it("builds the same mutant from the same seed", () => {
    const seed = `${FIXTURES[0]}|xml|7`;
    expect(mutant(seed)).toEqual(mutant(seed));
  });
});
