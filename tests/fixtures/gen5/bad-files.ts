// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// One bad Gen5 file per rule of docs/gen5-export.md, built in memory from invented values
// (Q-PRIV-4). Each case names the file it makes and the first error the parser must return.
import type { Gen5Error } from "../../../src/server/upload/errors.ts";
import {
  MAX_ARCHIVE_ENTRIES,
  MAX_UNPACKED_BYTES,
  MAX_UPLOAD_BYTES,
} from "../../../src/server/upload/limits.ts";
import {
  buildGen5Workbook,
  buildZip,
  type Cells,
  defaultSpec,
  gen5Cells,
  gradientWells,
  workbookParts,
} from "./xlsx-builder.ts";

/** A bad file: its name as uploaded, its bytes, and the fields of the first error it gives. */
export interface BadFile {
  readonly rule: string;
  readonly fileName: string;
  readonly bytes: () => Uint8Array;
  readonly firstError: Partial<Gen5Error> & { readonly kind: Gen5Error["kind"] };
}

function withCells(change: (cells: Cells) => void): Uint8Array {
  const cells = gen5Cells();
  change(cells);
  return buildGen5Workbook(cells);
}

function gridCells(cells: Cells): void {
  for (const ref of [...cells.keys()]) {
    const row = Number(/[0-9]+$/.exec(ref)?.[0] ?? 0);
    if (row >= 24) cells.delete(ref);
  }
}

const NAME = "plate.xlsx";

/** The bad files of the contract, one per rule. */
export const BAD_FILES: readonly BadFile[] = [
  {
    rule: "the file is over the upload limit",
    fileName: NAME,
    bytes: () => new Uint8Array(MAX_UPLOAD_BYTES + 1),
    firstError: { kind: "file_too_large", size: MAX_UPLOAD_BYTES + 1, limit: MAX_UPLOAD_BYTES },
  },
  {
    rule: "the extension is not .xlsx",
    fileName: "plate.xls",
    bytes: () => buildGen5Workbook(),
    firstError: { kind: "wrong_extension" },
  },
  {
    rule: "the file is not a zip (a CSV renamed to .xlsx)",
    fileName: NAME,
    bytes: () => new TextEncoder().encode("Well,Absorbance\nA1,0.123\n"),
    firstError: { kind: "not_a_zip" },
  },
  {
    rule: "the zip is no workbook",
    fileName: NAME,
    bytes: () => buildZip([{ name: "notes.txt", data: "an invented note" }]),
    firstError: { kind: "not_a_workbook", part: "[Content_Types].xml" },
  },
  {
    rule: "the workbook is macro-enabled",
    fileName: NAME,
    bytes: () =>
      buildGen5Workbook(gen5Cells(), {
        workbookContentType: "application/vnd.ms-excel.sheet.macroEnabled.main+xml",
      }),
    firstError: { kind: "not_a_workbook", part: "xl/workbook.xml" },
  },
  {
    rule: "the archive holds more entries than the limit",
    fileName: NAME,
    bytes: () =>
      buildZip(
        workbookParts({
          sheets: [gen5Cells()],
          extraParts: Array.from({ length: MAX_ARCHIVE_ENTRIES }, (_, index) => ({
            name: `docProps/extra${index}.xml`,
            data: "<x/>",
          })),
        }),
      ),
    firstError: {
      kind: "too_many_entries",
      count: MAX_ARCHIVE_ENTRIES + 6,
      limit: MAX_ARCHIVE_ENTRIES,
    },
  },
  {
    rule: "the declared unpacked size is over the limit",
    fileName: NAME,
    bytes: () =>
      buildZip(
        workbookParts({
          sheets: [gen5Cells()],
          extraParts: [{ name: "xl/media/large.bin", data: new Uint8Array(MAX_UNPACKED_BYTES) }],
        }),
      ),
    firstError: { kind: "unpacked_too_large", limit: MAX_UNPACKED_BYTES },
  },
  {
    rule: "a zip bomb: the sheet unpacks far past the size it declares",
    fileName: NAME,
    bytes: () => {
      const bomb = new Uint8Array(64 * 1024 * 1024);
      return buildZip(
        workbookParts({ sheets: [gen5Cells()] }).map((part) =>
          part.name === "xl/worksheets/sheet1.xml"
            ? { name: part.name, data: bomb, method: 8, declaredSize: 4096 }
            : part,
        ),
      );
    },
    firstError: { kind: "entry_size_mismatch", part: "xl/worksheets/sheet1.xml" },
  },
  {
    rule: "the sheet carries a DTD with an external entity",
    fileName: NAME,
    bytes: () =>
      buildGen5Workbook(gen5Cells(), {
        replace: new Map([
          [
            "xl/worksheets/sheet1.xml",
            '<?xml version="1.0"?><!DOCTYPE worksheet [<!ENTITY x SYSTEM "file:///etc/hostname">]><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>',
          ],
        ]),
      }),
    firstError: { kind: "xml_dtd_refused", part: "xl/worksheets/sheet1.xml" },
  },
  {
    rule: "the workbook holds two sheets (a second plate)",
    fileName: NAME,
    bytes: () => buildZip(workbookParts({ sheets: [gen5Cells(), gen5Cells()] })),
    firstError: { kind: "sheet_count", count: 2 },
  },
  {
    rule: "the grid is missing",
    fileName: NAME,
    bytes: () => withCells(gridCells),
    firstError: { kind: "grid_missing" },
  },
  {
    rule: "the grid has a 13th column",
    fileName: NAME,
    bytes: () =>
      withCells((cells) => {
        cells.set("O24", 13);
      }),
    firstError: { kind: "grid_shape", cell: "O24" },
  },
  {
    rule: "the grid has a 9th row",
    fileName: NAME,
    bytes: () =>
      withCells((cells) => {
        cells.set("B33", "I");
        cells.set("C33", 0.1);
      }),
    firstError: { kind: "grid_shape", cell: "B33" },
  },
  {
    rule: "the grid has only 7 rows",
    fileName: NAME,
    bytes: () =>
      withCells((cells) => {
        for (const ref of [...cells.keys()]) if (ref.endsWith("32")) cells.delete(ref);
      }),
    firstError: { kind: "grid_shape", cell: "B32" },
  },
  {
    rule: "a well is empty",
    fileName: NAME,
    bytes: () =>
      withCells((cells) => {
        cells.set("E27", null);
      }),
    firstError: { kind: "well_empty", well: "C3", cell: "E27" },
  },
  {
    rule: "a well holds text, not a number",
    fileName: NAME,
    bytes: () =>
      withCells((cells) => {
        cells.set("N32", "OVRFLW");
      }),
    firstError: { kind: "well_not_a_number", well: "H12", cell: "N32" },
  },
  {
    rule: "the read has two wavelengths",
    fileName: NAME,
    bytes: () =>
      withCells((cells) => {
        cells.set("B18", "Wavelengths:  450, 750");
      }),
    firstError: { kind: "wavelength_count", cell: "B18" },
  },
  {
    rule: "the read is kinetic, not an endpoint",
    fileName: NAME,
    bytes: () =>
      withCells((cells) => {
        cells.set("B16", "Absorbance Kinetic");
      }),
    firstError: { kind: "read_type_unsupported", cell: "B16" },
  },
  {
    rule: "the plate is not a 96-well plate",
    fileName: NAME,
    bytes: () =>
      withCells((cells) => {
        cells.set("B14", "384 WELL PLATE");
      }),
    firstError: { kind: "plate_type_unsupported", cell: "B14" },
  },
];

/** The invented spec and wells, re-exported for the tests that compare values. */
export { defaultSpec, gradientWells };
