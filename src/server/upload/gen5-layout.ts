// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The Gen5 export layout of an Epoch 2 absorbance endpoint read, pinned cell by cell from the
// export a teacher supplied on 2026-11-19 (#153, docs/gen5-export.md). Risk P-03: "the parser
// validates strictly", so every label must sit in its cell and no other cell may hold content.
import {
  PLATE_COLUMNS,
  PLATE_ROWS,
  type PlateColumn,
  type PlateRow,
  type WellId,
  wellId,
} from "../../lib/plate.ts";
import { type CellNumber, readCellNumber } from "./decimal.ts";
import type { HeaderField, LayoutError } from "./errors.ts";
import { type Cell, type SheetCells, splitCellReference } from "./workbook.ts";

/** The header fields the parser reads from the export. */
export interface Gen5Header {
  /** Digits and dots, 1 to 32 characters. */
  readonly softwareVersion: string;
  /** The date of the read as the reader's computer gave it, `YYYY-MM-DD`, without a time zone. */
  readonly date: string;
  /** The time of the read as the reader's computer gave it, `HH:MM:SS`, without a time zone. */
  readonly time: string;
  /** Printable ASCII, 1 to 64 characters. */
  readonly readerType: string;
  /** ASCII letters and digits, 1 to 32 characters. */
  readonly readerSerialNumber: string;
  readonly plateType: typeof PLATE_TYPE;
  readonly readType: typeof READ_TYPE;
  /** The one wavelength of the read, in nanometres. */
  readonly wavelengthNm: number;
  /** The actual temperature in the reader at the read, in degrees Celsius. */
  readonly temperatureCelsius: CellNumber;
}

/** One well of the plate with its absorbance. */
export interface PlateWell {
  readonly well: WellId;
  readonly row: PlateRow;
  readonly column: PlateColumn;
  readonly absorbance: CellNumber;
}

/** A parsed Gen5 export: the header and the 96 wells in reading order (A1 to H12). */
export interface Gen5Plate {
  readonly header: Gen5Header;
  readonly wells: readonly PlateWell[];
}

/** The plate type the contract accepts (96-well only, the maintainer's decision of 2026-11-12). */
export const PLATE_TYPE = "96 WELL PLATE";
/** The read type the contract accepts: one absorbance endpoint read. */
export const READ_TYPE = "Absorbance Endpoint";
const READ_AREA = "Full Plate";
const ONE_WAVELENGTH = /^Wavelengths: +([1-9][0-9]{0,3})$/;
const MANY_WAVELENGTHS = /^Wavelengths: +[0-9]+(?: *, *[0-9]+)+$/;

/** The label cells of the header block and the text each must hold exactly. */
const LABELS: readonly (readonly [string, string])[] = [
  ["A2", "Software Version"],
  ["A4", "Experiment File Path:"],
  ["A5", "Protocol File Path:"],
  ["A6", "Plate Number"],
  ["A7", "Date"],
  ["A8", "Time"],
  ["A9", "Reader Type:"],
  ["A10", "Reader Serial Number:"],
  ["A11", "Reading Type"],
  ["A13", "Procedure Details"],
  ["A14", "Plate Type"],
  ["A15", "Eject plate on completion"],
  ["A16", "Read"],
  ["A21", "Results"],
  ["A22", "Actual Temperature:"],
];

/**
 * Value cells the parser never reads into its result: the file paths can name a user account and
 * a user types the plate number in Gen5 (Q-PRIV-4).
 */
const IGNORED: ReadonlyMap<string, HeaderField> = new Map([
  ["B4", "experimentFilePath"],
  ["B5", "protocolFilePath"],
  ["B6", "plateNumber"],
  ["B11", "readingType"],
  ["B19", "readSpeed"],
]);

const VALUE_CELLS = ["B2", "B7", "B8", "B9", "B10", "B14", "B16", "B17", "B18", "B22"];

/** The header row of the grid: column numbers 1 to 12 in C24 to N24. */
const GRID_HEADER_ROW = 24;
/** The first row of wells (row A); the rows of wells are 25 to 32. */
const GRID_FIRST_ROW = 25;
/** The column of the row letters (B); the wells are in columns C (3) to N (14). */
const GRID_LABEL_COLUMN = 2;
/** The column after the wells (O) repeats the wavelength on every row of wells. */
const WAVELENGTH_COLUMN = 15;

function columnLetter(column: number): string {
  let letters = "";
  for (let rest = column; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    letters = String.fromCharCode(65 + ((rest - 1) % 26)) + letters;
  }
  return letters;
}

function ref(column: number, row: number): string {
  return `${columnLetter(column)}${row}`;
}

function wellCell(row: number, column: number): string {
  return ref(GRID_LABEL_COLUMN + column, GRID_FIRST_ROW + row);
}

const GRID_CELLS: ReadonlySet<string> = new Set([
  ...PLATE_COLUMNS.map((column) => ref(GRID_LABEL_COLUMN + column, GRID_HEADER_ROW)),
  ...PLATE_ROWS.flatMap((_, row) => [
    ref(GRID_LABEL_COLUMN, GRID_FIRST_ROW + row),
    ref(WAVELENGTH_COLUMN, GRID_FIRST_ROW + row),
    ...PLATE_COLUMNS.map((column) => wellCell(row, column)),
  ]),
]);

const KNOWN_CELLS: ReadonlySet<string> = new Set([
  ...LABELS.map(([cell]) => cell),
  ...IGNORED.keys(),
  ...VALUE_CELLS,
  ...GRID_CELLS,
]);

function hasContent(cell: Cell | undefined): cell is Cell {
  return cell !== undefined && cell.kind !== "empty";
}

function textOf(cell: Cell | undefined): string | undefined {
  return cell?.kind === "text" ? cell.text : undefined;
}

function numberOf(cell: Cell | undefined): CellNumber | undefined {
  return cell?.kind === "number" ? readCellNumber(cell.raw) : undefined;
}

type FixedFieldError = "plate_type_unsupported" | "read_type_unsupported" | "read_area_unsupported";

class LayoutReader {
  readonly errors: LayoutError[] = [];
  private readonly sheet: SheetCells;

  constructor(sheet: SheetCells) {
    this.sheet = sheet;
  }

  cell(ref: string): Cell | undefined {
    return this.sheet.cells.get(ref);
  }

  /** Reads a value cell, recording `header_missing` or `header_invalid` when it fails. */
  field<T>(field: HeaderField, ref: string, read: (cell: Cell) => T | undefined): T | undefined {
    const cell = this.cell(ref);
    if (!hasContent(cell)) {
      this.errors.push({ kind: "header_missing", field, cell: ref });
      return undefined;
    }
    const value = read(cell);
    if (value === undefined) this.errors.push({ kind: "header_invalid", field, cell: ref });
    return value;
  }

  /** Reads a value cell that must hold one fixed text, recording `error` otherwise. */
  fixed<T extends string>(ref: string, expected: T, error: FixedFieldError): T | undefined {
    if (textOf(this.cell(ref)) === expected) return expected;
    this.errors.push({ kind: error, cell: ref });
    return undefined;
  }
}

// NOTE: the security review of #297 (ASVS 5.0 V2.2.1); header text is checked against a pattern.
const SOFTWARE_VERSION = /^[0-9.]{1,32}$/;
const READER_TYPE = /^[\x20-\x7e]{1,64}$/;
const SERIAL_NUMBER = /^[A-Za-z0-9]{1,32}$/;

function textMatching(pattern: RegExp): (cell: Cell) => string | undefined {
  return (cell) => {
    const text = textOf(cell);
    return text !== undefined && pattern.test(text) ? text : undefined;
  };
}

function serialNumber(cell: Cell): string | undefined {
  if (cell.kind === "number") {
    const value = readCellNumber(cell.raw);
    return value !== undefined &&
      Number.isSafeInteger(value.value) &&
      value.value >= 0 &&
      SERIAL_NUMBER.test(value.text)
      ? value.text
      : undefined;
  }
  return textMatching(SERIAL_NUMBER)(cell);
}

/** Day 0 of the 1900 and the 1904 date systems; serials before 1 March 1900 are refused. */
const EPOCH_1900 = Date.UTC(1899, 11, 30);
const EPOCH_1904 = Date.UTC(1904, 0, 1);
const FIRST_SAFE_1900_SERIAL = 61;
const MS_PER_DAY = 86_400_000;

function calendarDate(cell: Cell, date1904: boolean): string | undefined {
  const serial = numberOf(cell)?.value;
  if (serial === undefined || !Number.isInteger(serial)) return undefined;
  if (date1904 ? serial < 0 : serial < FIRST_SAFE_1900_SERIAL) return undefined;
  const date = new Date((date1904 ? EPOCH_1904 : EPOCH_1900) + serial * MS_PER_DAY);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
}

function timeOfDay(cell: Cell): string | undefined {
  const fraction = numberOf(cell)?.value;
  if (fraction === undefined || fraction < 0 || fraction >= 1) return undefined;
  const seconds = Math.round(fraction * 86_400);
  if (seconds >= 86_400) return undefined;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
}

function readWavelength(reader: LayoutReader): number | undefined {
  const cell = reader.cell("B18");
  const text = textOf(cell);
  const one = text === undefined ? null : ONE_WAVELENGTH.exec(text);
  if (one !== null) return Number(one[1]);
  if (text !== undefined && MANY_WAVELENGTHS.test(text)) {
    reader.errors.push({ kind: "wavelength_count", cell: "B18" });
  } else {
    const kind = hasContent(cell) ? "header_invalid" : "header_missing";
    reader.errors.push({ kind, field: "wavelength", cell: "B18" });
  }
  return undefined;
}

function sortedRefs(cells: Iterable<string>): string[] {
  const keyed = [...cells].map((cell) => ({ cell, at: splitCellReference(cell) }));
  return keyed
    .sort(
      (a, b) => (a.at?.row ?? 0) - (b.at?.row ?? 0) || (a.at?.column ?? 0) - (b.at?.column ?? 0),
    )
    .map(({ cell }) => cell);
}

/** Checks the grid frame; returns false when the wells cannot be read as an 8 by 12 grid. */
function checkGridFrame(reader: LayoutReader, contentRefs: readonly string[]): boolean {
  const gridContent = contentRefs.filter((cell) => GRID_CELLS.has(cell));
  if (gridContent.length === 0) {
    reader.errors.push({ kind: "grid_missing" });
    return false;
  }
  const misplaced = contentRefs.find((cell) => {
    const at = splitCellReference(cell);
    return at !== undefined && at.row >= GRID_HEADER_ROW && !KNOWN_CELLS.has(cell);
  });
  const badColumn = PLATE_COLUMNS.map((column) =>
    ref(GRID_LABEL_COLUMN + column, GRID_HEADER_ROW),
  ).find((cell, index) => numberOf(reader.cell(cell))?.value !== PLATE_COLUMNS[index]);
  const badRow = PLATE_ROWS.map((_, row) => ref(GRID_LABEL_COLUMN, GRID_FIRST_ROW + row)).find(
    (cell, index) => textOf(reader.cell(cell)) !== PLATE_ROWS[index],
  );
  const shape = badColumn ?? badRow ?? misplaced;
  if (shape === undefined) return true;
  reader.errors.push({ kind: "grid_shape", cell: shape });
  return false;
}

function readWells(reader: LayoutReader, wavelengthNm: number | undefined): PlateWell[] {
  const wells: PlateWell[] = [];
  PLATE_ROWS.forEach((row, rowIndex) => {
    for (const column of PLATE_COLUMNS) {
      const cellRef = wellCell(rowIndex, column);
      const cell = reader.cell(cellRef);
      const well = wellId(row, column);
      const absorbance = numberOf(cell);
      if (!hasContent(cell)) reader.errors.push({ kind: "well_empty", well, cell: cellRef });
      else if (absorbance === undefined) {
        reader.errors.push({ kind: "well_not_a_number", well, cell: cellRef });
      } else wells.push({ well, row, column, absorbance });
    }
    const wavelengthRef = ref(WAVELENGTH_COLUMN, GRID_FIRST_ROW + rowIndex);
    const repeated = numberOf(reader.cell(wavelengthRef))?.value;
    if (wavelengthNm !== undefined && repeated !== wavelengthNm) {
      reader.errors.push({ kind: "wavelength_mismatch", cell: wavelengthRef });
    }
  });
  return wells;
}

/** The result of {@link readGen5Layout}. */
export type LayoutResult =
  | { readonly ok: true; readonly plate: Gen5Plate }
  | { readonly ok: false; readonly errors: readonly [LayoutError, ...LayoutError[]] };

/**
 * Reads the header block and the 96-well grid of a Gen5 export sheet.
 *
 * Returns every layout error it finds, each naming its cell or well, so a refusal can name the
 * item in error (S4; WCAG 2.1 SC 3.3.1). A wrong grid frame stops the well checks, and only the
 * first misplaced cell is reported, so a file in another layout gives a short list.
 */
export function readGen5Layout(sheet: SheetCells): LayoutResult {
  const reader = new LayoutReader(sheet);
  for (const [cell, expected] of LABELS) {
    if (textOf(reader.cell(cell)) !== expected) {
      reader.errors.push({ kind: "label_missing", cell, expected });
    }
  }
  const softwareVersion = reader.field("softwareVersion", "B2", textMatching(SOFTWARE_VERSION));
  const date = reader.field("date", "B7", (cell) => calendarDate(cell, sheet.date1904));
  const time = reader.field("time", "B8", timeOfDay);
  const readerType = reader.field("readerType", "B9", textMatching(READER_TYPE));
  const readerSerialNumber = reader.field("readerSerialNumber", "B10", serialNumber);
  const plateType = reader.fixed("B14", PLATE_TYPE, "plate_type_unsupported");
  const readType = reader.fixed("B16", READ_TYPE, "read_type_unsupported");
  reader.fixed("B17", READ_AREA, "read_area_unsupported");
  const wavelengthNm = readWavelength(reader);
  const temperatureCelsius = reader.field("temperature", "B22", numberOf);

  const contentRefs = sortedRefs(
    [...sheet.cells].filter(([, cell]) => hasContent(cell)).map(([cell]) => cell),
  );
  const stray = contentRefs.find((cell) => {
    const at = splitCellReference(cell);
    return at !== undefined && at.row < GRID_HEADER_ROW && !KNOWN_CELLS.has(cell);
  });
  if (stray !== undefined) reader.errors.push({ kind: "unexpected_content", cell: stray });

  const wells = checkGridFrame(reader, contentRefs) ? readWells(reader, wavelengthNm) : [];
  const [first, ...rest] = reader.errors;
  if (first !== undefined) return { ok: false, errors: [first, ...rest] };
  if (
    softwareVersion === undefined ||
    date === undefined ||
    time === undefined ||
    readerType === undefined ||
    readerSerialNumber === undefined ||
    plateType === undefined ||
    readType === undefined ||
    wavelengthNm === undefined ||
    temperatureCelsius === undefined
  ) {
    throw new Error("the Gen5 layout reader lost a header field without recording an error");
  }
  return {
    ok: true,
    plate: {
      header: {
        softwareVersion,
        date,
        time,
        readerType,
        readerSerialNumber,
        plateType,
        readType,
        wavelengthNm,
        temperatureCelsius,
      },
      wells,
    },
  };
}
