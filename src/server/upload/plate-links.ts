// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The check of a parsed Gen5 plate and of the team's link from each well to a sample, before any
// value is used (S4, S10, R-06; #155). The export holds no sample number, so the team says which
// well holds which sample, by the sample's lab number. A pure function: the caller loads the
// lab's samples in its own transaction and passes them in.
import "@tanstack/react-start/server-only";
import { parseDecimal } from "../../lib/decimal.ts";
import { isLabNumber } from "../../lib/lab-number.ts";
import type { SampleId } from "../../lib/lab-records.ts";
import { type PlateColumn, type PlateRow, plateWells, type WellId } from "../../lib/plate.ts";
import type { LabId } from "../../lib/simulations.ts";
import { boundText } from "./errors.ts";
import type { Gen5Plate } from "./gen5-layout.ts";

/** A sample of the uploader's own lab, as the caller loaded it from the database. */
export interface LabSample {
  readonly id: SampleId;
  readonly labId: LabId;
  /** Ten digits with a Damm check digit, unique across every simulation (S12, R-11). */
  readonly labNumber: string;
  /** The sample number from the paper form; only unique per tube within a lab, so never a key. */
  readonly sampleNumber: string;
}

/** One link the team made: the well position as it was sent, and the lab number of a sample. */
export interface WellLinkInput {
  readonly well: string;
  readonly labNumber: string;
}

/**
 * Why a plate or a link is refused. Each names the well it is about, so a message can name it
 * (WCAG 2.1 SC 3.3.1). A position that is no well of the plate is kept as sent, cut to 128
 * characters, with the index of its link.
 */
export type PlateLinkRefusal =
  | { readonly code: "well_outside_plate"; readonly position: string; readonly index: number }
  | { readonly code: "value_empty"; readonly well: WellId }
  | { readonly code: "value_duplicate"; readonly well: WellId }
  | { readonly code: "value_out_of_bounds"; readonly well: WellId }
  | { readonly code: "link_duplicate"; readonly well: WellId }
  | { readonly code: "lab_number_missing"; readonly well: WellId }
  | { readonly code: "lab_number_invalid"; readonly well: WellId }
  | { readonly code: "sample_unknown"; readonly well: WellId };

/** The code of a {@link PlateLinkRefusal}. */
export type PlateLinkRefusalCode = PlateLinkRefusal["code"];

/** The sample a well is linked to: what the team may see of its own sample. */
export interface LinkedSample {
  readonly id: SampleId;
  readonly labNumber: string;
  readonly sampleNumber: string;
}

/** One well of a checked plate: its absorbance as an exact decimal, and its sample if linked. */
export interface CheckedWell {
  readonly well: WellId;
  readonly row: PlateRow;
  readonly column: PlateColumn;
  /** A canonical decimal of at most 9 digits before the point and 6 after (`parseDecimal`). */
  readonly absorbance: string;
  readonly sample: LinkedSample | null;
}

/** The result of {@link checkPlateLinks}: the 96 checked wells, or every refusal at once. */
export type PlateLinkResult =
  | { readonly ok: true; readonly wells: readonly CheckedWell[] }
  | {
      readonly ok: false;
      readonly refusals: readonly [PlateLinkRefusal, ...PlateLinkRefusal[]];
    };

/** Thrown when the caller passes a sample of another lab: a defect in its query, never input. */
export class ForeignSampleError extends Error {
  override readonly name = "ForeignSampleError";
}

const WELLS = plateWells();
const WELL_IDS: ReadonlySet<string> = new Set(WELLS.map(({ well }) => well));

function isWellId(value: string): value is WellId {
  return WELL_IDS.has(value);
}

/** Returns the absorbance of each well that holds exactly one value, and the plate's refusals. */
function checkValues(plate: Gen5Plate): {
  readonly values: ReadonlyMap<WellId, string>;
  readonly refusals: readonly PlateLinkRefusal[];
} {
  const texts = new Map<WellId, string[]>();
  for (const { well, absorbance } of plate.wells) {
    const seen = texts.get(well);
    if (seen === undefined) texts.set(well, [absorbance.text]);
    else seen.push(absorbance.text);
  }
  const values = new Map<WellId, string>();
  const refusals: PlateLinkRefusal[] = [];
  for (const { well } of WELLS) {
    const seen = texts.get(well) ?? [];
    const [text] = seen;
    if (text === undefined || text.trim() === "") {
      refusals.push({ code: "value_empty", well });
    } else if (seen.length > 1) {
      refusals.push({ code: "value_duplicate", well });
    } else {
      // NOTE: the bounds of `checkTolerance` (S15); a value outside them is refused, never rounded.
      const decimal = parseDecimal(text);
      if (decimal === null) refusals.push({ code: "value_out_of_bounds", well });
      else values.set(well, decimal);
    }
  }
  return { values, refusals };
}

/** Returns the sample of each linked well, and the refusals of the links in the order sent. */
function checkLinks(
  links: readonly WellLinkInput[],
  byLabNumber: ReadonlyMap<string, LabSample>,
): {
  readonly linked: ReadonlyMap<WellId, LinkedSample>;
  readonly refusals: readonly PlateLinkRefusal[];
} {
  const linked = new Map<WellId, LinkedSample>();
  const counts = new Map<WellId, number>();
  for (const { well } of links) {
    if (isWellId(well)) counts.set(well, (counts.get(well) ?? 0) + 1);
  }
  const refusals: PlateLinkRefusal[] = [];
  const reported = new Set<WellId>();
  links.forEach(({ well, labNumber }, index) => {
    if (!isWellId(well)) {
      refusals.push({ code: "well_outside_plate", position: boundText(well), index });
      return;
    }
    if ((counts.get(well) ?? 0) > 1) {
      if (!reported.has(well)) refusals.push({ code: "link_duplicate", well });
      reported.add(well);
      return;
    }
    if (labNumber.trim() === "") {
      refusals.push({ code: "lab_number_missing", well });
      return;
    }
    if (!isLabNumber(labNumber)) {
      refusals.push({ code: "lab_number_invalid", well });
      return;
    }
    const sample = byLabNumber.get(labNumber);
    if (sample === undefined) {
      refusals.push({ code: "sample_unknown", well });
      return;
    }
    linked.set(well, {
      id: sample.id,
      labNumber: sample.labNumber,
      sampleNumber: sample.sampleNumber,
    });
  });
  return { linked, refusals };
}

/**
 * Checks a parsed Gen5 plate and the team's links from wells to samples for one lab (S4, R-06).
 *
 * The plate must hold one value for each of the 96 wells, each an exact decimal of at most 9
 * digits before the point and 6 after. A link names a well from A1 to H12, at most once, and a
 * sample by its lab number; it matches only a sample of `labId` (S10), so a sample number shared
 * with another lab never matches. Several wells may hold one sample (replicates, #278), and a
 * well without a link stays unlinked. Every refusal is returned together: the plate's in reading
 * order, then the links' in the order sent.
 *
 * @throws ForeignSampleError when `samples` holds a sample of another lab.
 */
export function checkPlateLinks(input: {
  readonly labId: LabId;
  readonly plate: Gen5Plate;
  readonly links: readonly WellLinkInput[];
  readonly samples: readonly LabSample[];
}): PlateLinkResult {
  const byLabNumber = new Map<string, LabSample>();
  for (const sample of input.samples) {
    if (sample.labId !== input.labId) {
      throw new ForeignSampleError("a sample of another lab was passed to the plate check");
    }
    byLabNumber.set(sample.labNumber, sample);
  }
  const plate = checkValues(input.plate);
  const links = checkLinks(input.links, byLabNumber);
  const [first, ...rest] = [...plate.refusals, ...links.refusals];
  if (first !== undefined) return { ok: false, refusals: [first, ...rest] };
  return {
    ok: true,
    wells: WELLS.map(({ well, row, column }) => {
      const absorbance = plate.values.get(well);
      if (absorbance === undefined) throw new RangeError(`no checked value for ${well}`);
      return { well, row, column, absorbance, sample: links.linked.get(well) ?? null };
    }),
  };
}
