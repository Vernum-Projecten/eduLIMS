// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Unit tests of the check of a plate and the team's links from wells to samples (S4, S10, R-06;
// #155). Every lab, sample and value here is invented (Q-PRIV-4).
import { describe, expect, it } from "vitest";
import { withCheckDigit } from "../../lib/lab-number.ts";
import { parseSampleId } from "../../lib/lab-records.ts";
import { plateWells } from "../../lib/plate.ts";
import { parseLabId } from "../../lib/simulations.ts";
import type { Gen5Plate, PlateWell } from "./gen5-layout.ts";
import { MAX_ERROR_TEXT } from "./limits.ts";
import {
  checkPlateLinks,
  ForeignSampleError,
  type LabSample,
  type PlateLinkResult,
  type WellLinkInput,
} from "./plate-links.ts";

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

const LAB_A = labId("0190a0a0-0000-7000-8000-00000000000a");
const LAB_B = labId("0190a0a0-0000-7000-8000-00000000000b");

const SAMPLE_A1: LabSample = {
  id: sampleId("0190a0a0-0000-7000-8000-0000000000a1"),
  labId: LAB_A,
  labNumber: withCheckDigit("100000001"),
  sampleNumber: "S-001",
};
const SAMPLE_A2: LabSample = {
  id: sampleId("0190a0a0-0000-7000-8000-0000000000a2"),
  labId: LAB_A,
  labNumber: withCheckDigit("100000002"),
  sampleNumber: "S-002",
};
// Lab B works the same sample number as lab A, as every team does (R-11).
const SAMPLE_B1: LabSample = {
  id: sampleId("0190a0a0-0000-7000-8000-0000000000b1"),
  labId: LAB_B,
  labNumber: withCheckDigit("200000001"),
  sampleNumber: "S-001",
};

function well(id: string, text: string): PlateWell {
  const found = plateWells().find((w) => w.well === id);
  if (found === undefined) throw new Error(`no well ${id}`);
  return { ...found, absorbance: { text, value: Number(text) } };
}

function plate(change?: (wells: PlateWell[]) => PlateWell[]): Gen5Plate {
  const wells = plateWells().map(({ well: id }, index) =>
    well(id, (0.05 + index / 100).toFixed(4)),
  );
  return {
    header: {
      softwareVersion: "3.11.19",
      date: "2026-01-02",
      time: "10:00:00",
      readerType: "Epoch 2",
      readerSerialNumber: "INVENTED1",
      plateType: "96 WELL PLATE",
      readType: "Absorbance Endpoint",
      wavelengthNm: 450,
      temperatureCelsius: { text: "21.5", value: 21.5 },
    },
    wells: change === undefined ? wells : change(wells),
  };
}

function check(
  links: readonly WellLinkInput[],
  options: { plate?: Gen5Plate; samples?: readonly LabSample[] } = {},
): PlateLinkResult {
  return checkPlateLinks({
    labId: LAB_A,
    plate: options.plate ?? plate(),
    links,
    samples: options.samples ?? [SAMPLE_A1, SAMPLE_A2],
  });
}

function refusalsOf(result: PlateLinkResult) {
  if (result.ok) throw new Error("expected a refusal");
  return result.refusals;
}

function wellsOf(result: PlateLinkResult) {
  if (!result.ok) throw new Error(`expected wells, got ${JSON.stringify(result.refusals)}`);
  return result.wells;
}

describe("a plate without links", () => {
  it("returns the 96 wells in reading order, unlinked, with exact decimals (S4)", () => {
    const wells = wellsOf(check([]));
    expect(wells).toHaveLength(96);
    expect(wells[0]).toEqual({
      well: "A1",
      row: "A",
      column: 1,
      absorbance: "0.0500",
      sample: null,
    });
    expect(wells[95]).toMatchObject({ well: "H12", row: "H", column: 12, absorbance: "1.0000" });
  });
});

describe("the well positions (S4)", () => {
  it.each(["A1", "H12", "A12", "H1"])("accepts the corner %s", (position) => {
    const wells = wellsOf(check([{ well: position, labNumber: SAMPLE_A1.labNumber }]));
    expect(wells.find((w) => w.well === position)?.sample).toEqual({
      id: SAMPLE_A1.id,
      labNumber: SAMPLE_A1.labNumber,
      sampleNumber: "S-001",
    });
  });

  it.each(["A13", "I1", "I01", "A0", "A01", "a1", "H 12", " A1", "", "Z99"])(
    "refuses %j as outside the plate",
    (position) => {
      expect(refusalsOf(check([{ well: position, labNumber: SAMPLE_A1.labNumber }]))).toEqual([
        { code: "well_outside_plate", position, index: 0 },
      ]);
    },
  );

  it("cuts a long position to the error text limit", () => {
    const [refusal] = refusalsOf(check([{ well: "A".repeat(500), labNumber: "" }]));
    expect(refusal).toEqual({
      code: "well_outside_plate",
      position: "A".repeat(MAX_ERROR_TEXT),
      index: 0,
    });
  });
});

describe("empty and duplicate values on the plate", () => {
  it("refuses a well that holds no value", () => {
    const missing = plate((wells) => wells.filter((w) => w.well !== "C3"));
    expect(refusalsOf(check([], { plate: missing }))).toEqual([
      { code: "value_empty", well: "C3" },
    ]);
  });

  it("refuses a well whose value is empty text", () => {
    const blank = plate((wells) => wells.map((w) => (w.well === "A1" ? well("A1", " ") : w)));
    expect(refusalsOf(check([], { plate: blank }))).toEqual([{ code: "value_empty", well: "A1" }]);
  });

  it("refuses a well that holds two values", () => {
    const twice = plate((wells) => [...wells, well("H12", "0.1")]);
    expect(refusalsOf(check([], { plate: twice }))).toEqual([
      { code: "value_duplicate", well: "H12" },
    ]);
  });

  it("refuses two equal values in one well too", () => {
    const twice = plate((wells) => [...wells, well("B2", "0.1400")]);
    expect(refusalsOf(check([], { plate: twice }))).toEqual([
      { code: "value_duplicate", well: "B2" },
    ]);
  });
});

describe("the bounds of a value (as checkTolerance reads it)", () => {
  function withA1(text: string) {
    return check([], {
      plate: plate((ws) => ws.map((w) => (w.well === "A1" ? well("A1", text) : w))),
    });
  }

  it.each([
    ["999999999.999999", "999999999.999999"],
    ["0.000001", "0.000001"],
    ["-0.25", "-0.25"],
    ["0", "0"],
  ])("accepts %s", (text, expected) => {
    expect(wellsOf(withA1(text))[0]?.absorbance).toBe(expected);
  });

  it.each(["1000000000", "0.0000001", "0.1234567", "1e-7"])("refuses %s", (text) => {
    expect(refusalsOf(withA1(text))).toEqual([{ code: "value_out_of_bounds", well: "A1" }]);
  });
});

describe("the links to samples (S4, S10, R-06)", () => {
  it("links several wells to one sample (replicates)", () => {
    const wells = wellsOf(
      check([
        { well: "A1", labNumber: SAMPLE_A1.labNumber },
        { well: "A2", labNumber: SAMPLE_A1.labNumber },
        { well: "B1", labNumber: SAMPLE_A2.labNumber },
      ]),
    );
    expect(wells.filter((w) => w.sample?.id === SAMPLE_A1.id).map((w) => w.well)).toEqual([
      "A1",
      "A2",
    ]);
    expect(wells.find((w) => w.well === "B1")?.sample?.id).toBe(SAMPLE_A2.id);
  });

  it("refuses a well linked twice, once", () => {
    expect(
      refusalsOf(
        check([
          { well: "D4", labNumber: SAMPLE_A1.labNumber },
          { well: "D4", labNumber: SAMPLE_A2.labNumber },
          { well: "D4", labNumber: SAMPLE_A1.labNumber },
        ]),
      ),
    ).toEqual([{ code: "link_duplicate", well: "D4" }]);
  });

  it.each(["", "   "])("refuses an empty lab number %j", (labNumber) => {
    expect(refusalsOf(check([{ well: "A1", labNumber }]))).toEqual([
      { code: "lab_number_missing", well: "A1" },
    ]);
  });

  it.each(["S-001", "1000000010", "100 000 001", "12345"])(
    "refuses %j, which is no lab number",
    (labNumber) => {
      expect(refusalsOf(check([{ well: "A1", labNumber }]))).toEqual([
        { code: "lab_number_invalid", well: "A1" },
      ]);
    },
  );

  it("refuses a lab number that names no sample", () => {
    expect(refusalsOf(check([{ well: "A1", labNumber: withCheckDigit("999999999") }]))).toEqual([
      { code: "sample_unknown", well: "A1" },
    ]);
  });

  it("never matches the sample of another lab with the same sample number (S10, R-11)", () => {
    expect(refusalsOf(check([{ well: "A1", labNumber: SAMPLE_B1.labNumber }]))).toEqual([
      { code: "sample_unknown", well: "A1" },
    ]);
    expect(refusalsOf(check([{ well: "A1", labNumber: SAMPLE_B1.sampleNumber }]))).toEqual([
      { code: "lab_number_invalid", well: "A1" },
    ]);
  });

  it("throws when the caller passes a sample of another lab", () => {
    expect(() => check([], { samples: [SAMPLE_A1, SAMPLE_B1] })).toThrow(ForeignSampleError);
  });
});

describe("every refusal together", () => {
  it("reports the plate's refusals in reading order, then the links' in the order sent", () => {
    const broken = plate((wells) => [...wells.filter((w) => w.well !== "H12"), well("A2", "0.1")]);
    expect(
      refusalsOf(
        check(
          [
            { well: "I1", labNumber: SAMPLE_A1.labNumber },
            { well: "B1", labNumber: "" },
            { well: "C1", labNumber: SAMPLE_B1.labNumber },
          ],
          { plate: broken },
        ),
      ),
    ).toEqual([
      { code: "value_duplicate", well: "A2" },
      { code: "value_empty", well: "H12" },
      { code: "well_outside_plate", position: "I1", index: 0 },
      { code: "lab_number_missing", well: "B1" },
      { code: "sample_unknown", well: "C1" },
    ]);
  });
});
