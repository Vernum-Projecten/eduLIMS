// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Data tests of the Gen5 parser over the fixture set (S4; #153, #154): every good file parses,
// every bad file gives its typed error, and each limit holds at and just over its boundary.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type Gen5ParseResult, parseGen5Export } from "../../src/server/upload/gen5.ts";
import {
  MAX_ARCHIVE_ENTRIES,
  MAX_UNPACKED_BYTES,
  MAX_UPLOAD_BYTES,
} from "../../src/server/upload/limits.ts";
import { BAD_FILES } from "../fixtures/gen5/bad-files.ts";
import {
  buildGen5Workbook,
  buildZip,
  type Cells,
  gen5Cells,
  gradientFixture,
  gradientWells,
  workbookParts,
  type ZipPart,
} from "../fixtures/gen5/xlsx-builder.ts";

const FIXTURES = new URL("../fixtures/gen5/", import.meta.url);

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(name, FIXTURES)));
}

function plateOf(result: Gen5ParseResult) {
  if (!result.ok) throw new Error(`expected a plate, got ${JSON.stringify(result.errors)}`);
  return result.plate;
}

function errorsOf(result: Gen5ParseResult) {
  if (result.ok) throw new Error("expected the file to be refused");
  return result.errors;
}

function parseCells(change: (cells: Cells) => void) {
  const cells = gen5Cells();
  change(cells);
  return parseGen5Export({ fileName: "plate.xlsx", bytes: buildGen5Workbook(cells) });
}

describe("the export a teacher supplied (S4)", () => {
  const plate = plateOf(
    parseGen5Export({
      fileName: "epoch2-endpoint-750nm-air.xlsx",
      bytes: fixture("epoch2-endpoint-750nm-air.xlsx"),
    }),
  );

  it("reads the header fields of the contract", () => {
    expect(plate.header).toEqual({
      softwareVersion: "3.11.19",
      plateNumber: "Plate 1",
      date: "2026-11-19",
      time: "14:39:10",
      readerType: "Epoch 2",
      readerSerialNumber: "2204112B",
      plateType: "96 WELL PLATE",
      readType: "Absorbance Endpoint",
      wavelengthNm: 750,
      temperatureCelsius: { text: "19.6", value: 19.6 },
    });
  });

  it("reads 96 wells in reading order, A1 to H12", () => {
    expect(plate.wells).toHaveLength(96);
    expect(plate.wells[0]).toMatchObject({ well: "A1", row: "A", column: 1 });
    expect(plate.wells[11]).toMatchObject({ well: "A12", row: "A", column: 12 });
    expect(plate.wells[12]).toMatchObject({ well: "B1", row: "B", column: 1 });
    expect(plate.wells[95]).toMatchObject({ well: "H12", row: "H", column: 12 });
  });

  it("keeps each absorbance as the stored double and its shortest decimal", () => {
    const byWell = new Map(plate.wells.map((well) => [well.well, well.absorbance]));
    expect(byWell.get("A1")).toEqual({ text: "0.042", value: 0.042 });
    expect(byWell.get("A12")).toEqual({ text: "0.04", value: 0.04 });
    expect(byWell.get("B12")).toEqual({ text: "0.034", value: 0.034 });
    expect(byWell.get("D10")).toEqual({ text: "0.037", value: 0.037 });
    for (const well of plate.wells) {
      expect(Number(well.absorbance.text)).toBe(well.absorbance.value);
    }
  });
});

describe("the invented gradient plate", () => {
  it("is the builder's output, byte for byte", () => {
    expect(fixture("epoch2-endpoint-450nm-gradient.xlsx")).toEqual(gradientFixture());
  });

  it("parses to the invented values", () => {
    const plate = plateOf(
      parseGen5Export({
        fileName: "epoch2-endpoint-450nm-gradient.xlsx",
        bytes: fixture("epoch2-endpoint-450nm-gradient.xlsx"),
      }),
    );
    expect(plate.header).toMatchObject({
      wavelengthNm: 450,
      date: "2026-11-20",
      time: "10:30:00",
      readerSerialNumber: "EX000001",
      temperatureCelsius: { text: "21.3", value: 21.3 },
    });
    expect(plate.wells.map((well) => well.absorbance.value)).toEqual(gradientWells().flat());
    expect(plate.wells.find((well) => well.well === "H12")?.absorbance.text).toBe("2.13");
  });
});

describe("one bad file per rule (S4: a file in another layout is rejected)", () => {
  for (const bad of BAD_FILES) {
    it(`refuses a file where ${bad.rule}`, () => {
      const errors = errorsOf(parseGen5Export({ fileName: bad.fileName, bytes: bad.bytes() }));
      expect(errors[0]).toMatchObject(bad.firstError);
    });
  }
});

/** Stored padding entry whose size makes the archive exactly `total` bytes long. */
function paddedTo(total: number): Uint8Array {
  const parts = (pad: number): ZipPart[] => [
    ...workbookParts({ sheets: [gen5Cells()] }),
    { name: "docProps/pad.bin", data: new Uint8Array(pad), method: 0 },
  ];
  const overhead = buildZip(parts(0)).length;
  return buildZip(parts(total - overhead));
}

/** A deflated padding entry whose size makes the unpacked total exactly `total` bytes. */
function unpackedTo(total: number): Uint8Array {
  const base = workbookParts({ sheets: [gen5Cells()] });
  const used = base.reduce(
    (sum, part) =>
      sum + (typeof part.data === "string" ? Buffer.byteLength(part.data) : part.data.length),
    0,
  );
  return buildZip([...base, { name: "docProps/pad.bin", data: new Uint8Array(total - used) }]);
}

function withEntries(count: number): Uint8Array {
  const base = workbookParts({ sheets: [gen5Cells()] });
  const extra = Array.from({ length: count - base.length }, (_, index) => ({
    name: `docProps/extra${index}.xml`,
    data: "<x/>",
  }));
  return buildZip([...base, ...extra]);
}

describe("the limits (ASVS 5.0 V5.2.1, V5.2.3)", () => {
  it("accepts a file of exactly the upload limit", () => {
    const bytes = paddedTo(MAX_UPLOAD_BYTES);
    expect(bytes.length).toBe(MAX_UPLOAD_BYTES);
    expect(parseGen5Export({ fileName: "plate.xlsx", bytes }).ok).toBe(true);
  });

  it("refuses a valid workbook one byte over the upload limit, before parsing", () => {
    const bytes = paddedTo(MAX_UPLOAD_BYTES + 1);
    expect(errorsOf(parseGen5Export({ fileName: "plate.xlsx", bytes }))).toEqual([
      { kind: "file_too_large", size: MAX_UPLOAD_BYTES + 1, limit: MAX_UPLOAD_BYTES },
    ]);
  });

  it("accepts exactly the unpacked limit", () => {
    const result = parseGen5Export({
      fileName: "plate.xlsx",
      bytes: unpackedTo(MAX_UNPACKED_BYTES),
    });
    expect(result.ok).toBe(true);
  });

  it("refuses one byte over the unpacked limit", () => {
    const bytes = unpackedTo(MAX_UNPACKED_BYTES + 1);
    expect(errorsOf(parseGen5Export({ fileName: "plate.xlsx", bytes }))).toEqual([
      { kind: "unpacked_too_large", size: MAX_UNPACKED_BYTES + 1, limit: MAX_UNPACKED_BYTES },
    ]);
  });

  it("accepts exactly the entry limit", () => {
    const result = parseGen5Export({
      fileName: "plate.xlsx",
      bytes: withEntries(MAX_ARCHIVE_ENTRIES),
    });
    expect(result.ok).toBe(true);
  });

  it("refuses one entry over the entry limit", () => {
    const bytes = withEntries(MAX_ARCHIVE_ENTRIES + 1);
    expect(errorsOf(parseGen5Export({ fileName: "plate.xlsx", bytes }))).toEqual([
      { kind: "too_many_entries", count: MAX_ARCHIVE_ENTRIES + 1, limit: MAX_ARCHIVE_ENTRIES },
    ]);
  });
});

describe("the file name (ASVS 5.0 V5.2.2, V5.3.2)", () => {
  it("reads the extension without regard to case", () => {
    expect(parseGen5Export({ fileName: "PLATE.XLSX", bytes: buildGen5Workbook() }).ok).toBe(true);
  });

  it("uses a name with path segments only for its extension", () => {
    const result = parseGen5Export({
      fileName: "../../etc/plate.xlsx",
      bytes: buildGen5Workbook(),
    });
    expect(result.ok).toBe(true);
  });

  it("refuses a name without the extension", () => {
    expect(errorsOf(parseGen5Export({ fileName: "plate", bytes: buildGen5Workbook() }))).toEqual([
      { kind: "wrong_extension" },
    ]);
  });
});

describe("the header block", () => {
  it("names a label that is missing", () => {
    const errors = errorsOf(parseCells((cells) => cells.set("A9", "Reader:")));
    expect(errors).toEqual([{ kind: "label_missing", cell: "A9", expected: "Reader Type:" }]);
  });

  it("names a value that is missing", () => {
    const errors = errorsOf(parseCells((cells) => cells.set("B9", null)));
    expect(errors).toEqual([{ kind: "header_missing", field: "readerType", cell: "B9" }]);
  });

  it("refuses a date given as text", () => {
    const errors = errorsOf(parseCells((cells) => cells.set("B7", "19-11-2026")));
    expect(errors).toEqual([{ kind: "header_invalid", field: "date", cell: "B7" }]);
  });

  it("refuses a date serial before March 1900", () => {
    const errors = errorsOf(parseCells((cells) => cells.set("B7", 60)));
    expect(errors).toEqual([{ kind: "header_invalid", field: "date", cell: "B7" }]);
  });

  it("refuses a date serial with a fraction", () => {
    const errors = errorsOf(parseCells((cells) => cells.set("B7", 46346.5)));
    expect(errors).toEqual([{ kind: "header_invalid", field: "date", cell: "B7" }]);
  });

  it("refuses a time of one day or more", () => {
    const errors = errorsOf(parseCells((cells) => cells.set("B8", 1)));
    expect(errors).toEqual([{ kind: "header_invalid", field: "time", cell: "B8" }]);
  });

  it("refuses a time that rounds up to midnight", () => {
    const errors = errorsOf(parseCells((cells) => cells.set("B8", 0.999_999_99)));
    expect(errors).toEqual([{ kind: "header_invalid", field: "time", cell: "B8" }]);
  });

  it("reads a serial number stored as a number", () => {
    const plate = plateOf(parseCells((cells) => cells.set("B10", 12_345_678)));
    expect(plate.header.readerSerialNumber).toBe("12345678");
  });

  it("refuses a serial number with a fraction", () => {
    const errors = errorsOf(parseCells((cells) => cells.set("B10", 1.5)));
    expect(errors).toEqual([{ kind: "header_invalid", field: "readerSerialNumber", cell: "B10" }]);
  });

  it("refuses a temperature that is not a number", () => {
    const errors = errorsOf(parseCells((cells) => cells.set("B22", "warm")));
    expect(errors).toEqual([{ kind: "header_invalid", field: "temperature", cell: "B22" }]);
  });

  it("refuses a partial plate read", () => {
    const errors = errorsOf(parseCells((cells) => cells.set("B17", "A1..H6")));
    expect(errors).toEqual([{ kind: "read_area_unsupported", cell: "B17" }]);
  });

  it("names a missing wavelength line", () => {
    const errors = errorsOf(parseCells((cells) => cells.set("B18", null)));
    expect(errors[0]).toEqual({ kind: "header_missing", field: "wavelength", cell: "B18" });
  });

  it("refuses a wavelength line in another form", () => {
    const errors = errorsOf(parseCells((cells) => cells.set("B18", "Wavelength 450 nm")));
    expect(errors[0]).toEqual({ kind: "header_invalid", field: "wavelength", cell: "B18" });
  });

  it("refuses content in a cell outside the layout", () => {
    const errors = errorsOf(parseCells((cells) => cells.set("C2", "a note")));
    expect(errors).toEqual([{ kind: "unexpected_content", cell: "C2" }]);
  });

  it("never reads the file paths, which may name a user account (Q-PRIV-4)", () => {
    const plate = plateOf(parseCells((cells) => cells.set("B4", "C:\\Users\\someone\\x.xpt")));
    expect(JSON.stringify(plate)).not.toContain("someone");
  });

  it("reads labels stored as inline strings", () => {
    expect(parseCells((cells) => cells.set("A2", { inline: "Software Version" })).ok).toBe(true);
  });
});

describe("the grid", () => {
  it("returns every empty well, each by name", () => {
    const errors = errorsOf(
      parseCells((cells) => {
        cells.set("C25", null);
        cells.set("N32", null);
      }),
    );
    expect(errors).toEqual([
      { kind: "well_empty", well: "A1", cell: "C25" },
      { kind: "well_empty", well: "H12", cell: "N32" },
    ]);
  });

  it("refuses a formula in a well", () => {
    const errors = errorsOf(
      parseCells((cells) => cells.set("D26", { formula: "1/2", value: 0.5 })),
    );
    expect(errors).toEqual([{ kind: "well_not_a_number", well: "B2", cell: "D26" }]);
  });

  it("refuses an error value in a well", () => {
    const errors = errorsOf(parseCells((cells) => cells.set("D26", { error: "#N/A" })));
    expect(errors).toEqual([{ kind: "well_not_a_number", well: "B2", cell: "D26" }]);
  });

  it("refuses a number that is not finite", () => {
    const errors = errorsOf(parseCells((cells) => cells.set("D26", { raw: "INF" })));
    expect(errors).toEqual([{ kind: "well_not_a_number", well: "B2", cell: "D26" }]);
  });

  it("refuses a row whose repeated wavelength differs from the header", () => {
    const errors = errorsOf(parseCells((cells) => cells.set("O27", 750)));
    expect(errors).toEqual([{ kind: "wavelength_mismatch", cell: "O27" }]);
  });

  it("refuses a column label out of order", () => {
    const errors = errorsOf(parseCells((cells) => cells.set("E24", 4)));
    expect(errors).toEqual([{ kind: "grid_shape", cell: "E24" }]);
  });

  it("refuses a row label out of order", () => {
    const errors = errorsOf(parseCells((cells) => cells.set("B26", "C")));
    expect(errors).toEqual([{ kind: "grid_shape", cell: "B26" }]);
  });

  it("accepts negative and zero absorbances as numbers", () => {
    const plate = plateOf(
      parseCells((cells) => {
        cells.set("C25", { raw: "-1.0E-3" });
        cells.set("D25", { raw: "-0" });
      }),
    );
    expect(plate.wells[0]?.absorbance).toEqual({ text: "-0.001", value: -0.001 });
    expect(plate.wells[1]?.absorbance).toEqual({ text: "0", value: 0 });
  });
});

describe("the date system", () => {
  it("reads the date in the 1904 date system when the workbook says so", () => {
    const parts = workbookParts({ sheets: [gen5Cells()] }).map((part) =>
      part.name === "xl/workbook.xml" && typeof part.data === "string"
        ? { ...part, data: part.data.replace("<sheets>", '<workbookPr date1904="1"/><sheets>') }
        : part,
    );
    const plate = plateOf(parseGen5Export({ fileName: "plate.xlsx", bytes: buildZip(parts) }));
    expect(plate.header.date).toBe("2030-11-21");
  });
});
