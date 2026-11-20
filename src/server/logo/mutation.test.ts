// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// A seeded, deterministic mutation test of the logo filter (#292), as the Gen5 readers have one:
// every mutant of a good PNG or JPEG with metadata gives a typed refusal or an image, never a
// throw; an accepted image holds only the kept chunks or segments, none of the metadata, stays
// in the limits, and filters to itself again. A failure prints its seed and mutant number.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { LOGO_MAX_BYTES, LOGO_MAX_SIDE } from "../../lib/lab-logo.ts";
import { checkLogo } from "./image.ts";
import { PNG_KEPT_CHUNKS } from "./png.ts";
import {
  ascii,
  contains,
  exifWithPosition,
  jpeg,
  jpegAdobe,
  jpegMetadataSegments,
  png,
  pngMetadataChunks,
} from "./test-images.ts";

const MUTANTS = 3_000;
/** The budget of one format's run: small files, with room for a slow CI runner. */
const BUDGET_MS = 20_000;
const SEED = process.env["LOGO_MUTATION_SEED"] ?? "lab-logo-292";

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
  const out = Array.from(bytes);
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
        out.length = at;
    }
  }
  return Uint8Array.from(out);
}

/** Returns the chunk types of a PNG the filter wrote, in order. */
function chunkTypes(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const types: string[] = [];
  for (let at = 8; at + 12 <= bytes.length; at += 12 + view.getUint32(at)) {
    types.push(String.fromCharCode(...bytes.subarray(at + 4, at + 8)));
  }
  return types;
}

const POSITION = exifWithPosition();
const INVENTED = ascii("invented");

function run(name: string, good: Uint8Array, checkKept: (bytes: Uint8Array) => void): void {
  it(`gives a typed result for ${MUTANTS} mutants of a ${name}, within ${BUDGET_MS} ms`, () => {
    const next = random(`${SEED}:${name}`);
    const started = performance.now();
    let accepted = 0;
    for (let n = 0; n < MUTANTS; n += 1) {
      const mutant = mutate(good, next);
      const context = `seed ${SEED}, ${name} mutant ${n}`;
      const result = (() => {
        try {
          return checkLogo(mutant);
        } catch (error) {
          throw new Error(`${context} threw`, { cause: error });
        }
      })();
      if (!result.ok) {
        expect(result.fault.kind, context).toMatch(/^logo_/);
        continue;
      }
      accepted += 1;
      const { bytes, width, height } = result.image;
      expect(bytes.length, context).toBeLessThanOrEqual(LOGO_MAX_BYTES);
      expect(width, context).toBeLessThanOrEqual(LOGO_MAX_SIDE);
      expect(height, context).toBeLessThanOrEqual(LOGO_MAX_SIDE);
      expect(contains(bytes, POSITION), context).toBe(false);
      checkKept(bytes);
      const again = checkLogo(bytes);
      expect(again.ok && again.image.bytes, context).toEqual(bytes);
    }
    // Some mutants touch only metadata, so a share of them still filters to an image.
    expect(accepted).toBeGreaterThan(0);
    expect(performance.now() - started).toBeLessThan(BUDGET_MS);
  });
}

describe("the logo filter under mutation (#292)", () => {
  run("PNG", png(6, 4, { before: pngMetadataChunks(), after: pngMetadataChunks() }), (bytes) => {
    for (const type of chunkTypes(bytes)) expect(PNG_KEPT_CHUNKS.has(type), type).toBe(true);
  });

  run(
    "JPEG",
    jpeg(24, 16, { before: [...jpegMetadataSegments(), jpegAdobe()], restart: true }),
    (bytes) => {
      expect(contains(bytes, ascii("Exif")), "EXIF").toBe(false);
      expect(contains(bytes, INVENTED), "metadata text").toBe(false);
    },
  );
});
