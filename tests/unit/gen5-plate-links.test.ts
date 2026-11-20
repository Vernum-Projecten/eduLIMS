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
import { buildGen5Workbook, gen5Cells } from "../fixtures/gen5/xlsx-builder.ts";

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

describe("a value's text in the file, through the parser and the check", () => {
  /** Returns the checked absorbance of A1 (cell C25) when the file holds `raw` there. */
  function a1(raw: string) {
    const cells = gen5Cells();
    cells.set("C25", { raw });
    const parsed = parseGen5Export({ fileName: "plate.xlsx", bytes: buildGen5Workbook(cells) });
    if (!parsed.ok) throw new Error(`expected a plate, got ${JSON.stringify(parsed.errors)}`);
    return checkPlateLinks({ labId: LAB, plate: parsed.plate, links: [], samples: [] });
  }

  it.each([
    ["4.2000000000000003E-2", "0.042"],
    ["-0.000001", "-0.000001"],
    ["-999999999.999999", "-999999999.999999"],
    ["999999999.999999", "999999999.999999"],
  ])("reads %s as %s", (raw, expected) => {
    const result = a1(raw);
    if (!result.ok) throw new Error(`expected wells, got ${JSON.stringify(result.refusals)}`);
    expect(result.wells[0]?.absorbance).toBe(expected);
  });

  it.each([
    ["0.30000000000000004", "value_too_precise"],
    ["1.0000005", "value_too_precise"],
    ["1E9", "value_out_of_bounds"],
  ])("refuses %s as %s", (raw, code) => {
    expect(a1(raw)).toEqual({ ok: false, refusals: [{ code, well: "A1" }] });
  });
});
