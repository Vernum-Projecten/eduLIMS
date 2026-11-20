// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The server's half of the lab number (S12, R-11; maintainer, 2026-11-19 on #268): nine digits
// from a cryptographic source, so they say nothing about the simulation, the lab or the order of
// registration, and the Damm check digit. Unique under `samples_lab_number_key`; a draw that is
// taken already is drawn again inside the same transaction.
import "@tanstack/react-start/server-only";
import { randomInt } from "node:crypto";
import type { Transaction } from "kysely";
import { withCheckDigit } from "../../lib/lab-number.ts";
import type { SampleId } from "../../lib/lab-records.ts";
import { parseSampleId } from "../../lib/lab-records.ts";
import type { DB } from "../db/schema.gen.ts";

/** Returns a whole number in [0, `max`). */
export type DigitSource = (max: number) => number;

/**
 * How often a sample insert draws a new lab number after a collision. With 900 million numbers a
 * collision is rare; five in a row means the source is broken, and the insert fails loud.
 */
export const LAB_NUMBER_ATTEMPTS = 5;

/** Thrown when every draw of {@link LAB_NUMBER_ATTEMPTS} collided with a stored lab number. */
export class LabNumberExhaustedError extends Error {
  constructor() {
    super("no free lab number after the maximum number of draws");
    this.name = "LabNumberExhaustedError";
  }
}

/**
 * Returns a new lab number candidate: a first digit of 1 to 9 (so no analyser or spreadsheet
 * drops a leading zero), eight more digits and the Damm check digit.
 */
export function drawLabNumber(source: DigitSource = randomInt): string {
  const first = 1 + source(9);
  const rest = source(100_000_000).toString().padStart(8, "0");
  return withCheckDigit(`${first}${rest}`);
}

/** The columns of a new sample, apart from its lab number. */
export interface NewSample {
  simulationId: string;
  labId: string;
  requestId: string;
  sampleNumber: string;
  material: string;
  actorId: string;
}

/** A stored sample: its id and the lab number eduLIMS gave it. */
export interface StoredSample {
  id: SampleId;
  labNumber: string;
}

/**
 * Inserts a sample with a fresh lab number. A drawn number that another sample holds is skipped
 * by `on conflict do nothing`, so the transaction stays usable, and a new number is drawn.
 *
 * @throws LabNumberExhaustedError when every draw collided.
 */
export async function insertSample(
  trx: Transaction<DB>,
  sample: NewSample,
  source: DigitSource = randomInt,
): Promise<StoredSample> {
  for (let attempt = 0; attempt < LAB_NUMBER_ATTEMPTS; attempt += 1) {
    const labNumber = drawLabNumber(source);
    const row = await trx
      .insertInto("samples")
      .values({
        simulation_id: sample.simulationId,
        lab_id: sample.labId,
        request_id: sample.requestId,
        sample_number: sample.sampleNumber,
        material: sample.material,
        lab_number: labNumber,
        created_by: sample.actorId,
        updated_by: sample.actorId,
      })
      .onConflict((oc) => oc.column("lab_number").doNothing())
      .returning("id")
      .executeTakeFirst();
    const id = row ? parseSampleId(row.id) : null;
    if (id !== null) return { id, labNumber };
  }
  throw new LabNumberExhaustedError();
}
