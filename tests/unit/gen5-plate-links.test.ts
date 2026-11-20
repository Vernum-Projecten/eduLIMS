// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Data test of the upload check over the supplied export (S4, R-06; #155): the real air plate
// passes the parser and the check, and a link to an invented sample of the lab holds.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { withCheckDigit } from "../../src/lib/lab-number.ts";
import { parseSampleId } from "../../src/lib/lab-records.ts";
import { parseLabId } from "../../src/lib/simulations.ts";
import { parseGen5Export } from "../../src/server/upload/gen5.ts";
import { checkPlateLinks } from "../../src/server/upload/plate-links.ts";

function labId(value: string) {
  const id = parseLabId(value);
  if (id === null) throw new Error(`not a lab id: ${value}`);
  return id;
}

function sampleId(value: string) {
  const id = parseSampleId(value);
  if (id === null) throw new Error(`not a sample id: ${value}`);
  return id;
}

const LAB = labId("0190a0a0-0000-7000-8000-0000000000c1");
const SAMPLE = {
  id: sampleId("0190a0a0-0000-7000-8000-0000000000c2"),
  labId: LAB,
  labNumber: withCheckDigit("300000001"),
  sampleNumber: "INVENTED-1",
};

describe("the export a teacher supplied, through the parser and the check (S4)", () => {
  const parsed = parseGen5Export({
    fileName: "epoch2-endpoint-750nm-air.xlsx",
    bytes: new Uint8Array(
      readFileSync(new URL("../fixtures/gen5/epoch2-endpoint-750nm-air.xlsx", import.meta.url)),
    ),
  });
  if (!parsed.ok) throw new Error(`the fixture must parse: ${JSON.stringify(parsed.errors)}`);

  it("checks all 96 wells, each value an exact decimal equal to the parsed one", () => {
    const result = checkPlateLinks({
      labId: LAB,
      plate: parsed.plate,
      links: [
        { well: "A1", labNumber: SAMPLE.labNumber },
        { well: "H12", labNumber: SAMPLE.labNumber },
      ],
      samples: [SAMPLE],
    });
    if (!result.ok) throw new Error(`expected wells, got ${JSON.stringify(result.refusals)}`);
    expect(result.wells).toHaveLength(96);
    result.wells.forEach((checked, index) => {
      const source = parsed.plate.wells[index];
      expect(checked.well).toBe(source?.well);
      expect(Number(checked.absorbance)).toBe(source?.absorbance.value);
    });
    expect(result.wells.filter((w) => w.sample !== null).map((w) => w.well)).toEqual(["A1", "H12"]);
  });
});
