// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The vocabulary of correct values and accuracy limits (D10, D13, Q-SIM-1). A correct value is
// keyed by the simulation, the sample number and the catalogue test, never by a lab. Both are the
// application's secret: only teacher-scoped types carry them. No `@/` imports.
import { CONTROL_OR_FORMAT } from "./catalogue.ts";
import { parseDecimal } from "./decimal.ts";

declare const correctValueBrand: unique symbol;

/**
 * A correct value as a canonical decimal string (`src/lib/decimal.ts`). Its own type, so no
 * student-facing return type can take one by accident (Q-SIM-1, R-13).
 */
export type CorrectValue = string & { readonly [correctValueBrand]: true };

/** Returns a canonical decimal from a teacher-scoped read as a {@link CorrectValue}. */
export function asCorrectValue(value: string): CorrectValue {
  return value as CorrectValue;
}

/**
 * How a test's accuracy limits are expressed (D13, O2): a percentage of the correct value or an
 * absolute distance in the test's unit. One kind holds for both limits of a test, so the yellow
 * limit never lies beyond the red one.
 */
export const LIMIT_KINDS = ["percent", "absolute"] as const;
export type LimitKind = (typeof LIMIT_KINDS)[number];

/** Returns `value` when it names a {@link LimitKind}, else `undefined`. */
export function parseLimitKind(value: unknown): LimitKind | undefined {
  return LIMIT_KINDS.find((kind) => kind === value);
}

/** The accuracy limits of one test in one simulation (D13), teacher-scoped only. */
export interface AccuracyLimits {
  kind: LimitKind;
  /** The largest distance that is still green. */
  yellow: string;
  /** The largest distance that is still yellow; anything further is red. */
  red: string;
}

// NOTE: no requirement governs these bounds: our own design (#267), held by the CHECKs of
// migration 0018, so the form refuses what the database would.
/** The most characters a sample number takes. */
export const SAMPLE_NUMBER_MAX = 40;
/** The most rows one entry or paste of correct values takes. */
export const CORRECT_VALUES_BATCH_MAX = 500;

/** A test a pasted header may name: its id and its name in the catalogue. */
export interface PasteTest {
  id: string;
  name: string;
}

/** One pasted cell that reads as a correct value. */
export interface PastedRow {
  sampleNumber: string;
  testId: string;
  value: string;
}

/**
 * Why part of a pasted grid does not read (#401). `header` is a column's test name (`column` from
 * 1, the first test column), `row` a whole sample row (`row` from 1, the first sample row), and
 * `cell` one value at its row and column; `text` quotes an unknown test name.
 */
export type GridProblem =
  | {
      kind: "header";
      column: number;
      reason: "unknown_test" | "repeated_test" | "empty_test";
      text: string;
    }
  | { kind: "row"; row: number; reason: "sample_number" | "repeated_sample" | "columns" }
  | { kind: "cell"; row: number; column: number; reason: "number" };

/** A pasted grid as it reads: its tests by column, its samples by row, and every cell as text. */
export interface PastedGrid {
  /** The test name of each column as typed, and its catalogue id when it matched one. */
  columns: { text: string; testId: string | null }[];
  /** The sample number of each row as typed, and its cells as typed. */
  samples: { sampleNumber: string; cells: string[] }[];
  /** The cells that read as correct values; an empty cell is not requested and gives none. */
  rows: PastedRow[];
  problems: GridProblem[];
}

/** How much of an unknown test name a problem quotes, so the teacher finds the column. */
const QUOTE_MAX = 40;

function splitLine(line: string, separator: string): string[] {
  return line.split(separator).map((cell) => cell.trim());
}

/**
 * Reads a grid copied from a spreadsheet (#401): the first row names the tests, from the second
 * column on, matched to the catalogue by name regardless of case; the first column gives the
 * sample numbers; each other cell is the correct value of its test for its sample, and an empty
 * cell means the test is not requested for that sample. Cells are separated by a tab (a copied
 * spreadsheet) or a semicolon, so a comma stays free for the decimal separator. Blank lines are
 * skipped. An unknown test name is a problem, never a new test. Values are left as typed for the
 * schema to check and convert.
 */
export function parsePastedGrid(text: string, tests: readonly PasteTest[]): PastedGrid {
  const lines = text.split(/\r\n|\r|\n/).filter((line) => line.trim() !== "");
  const grid: PastedGrid = { columns: [], samples: [], rows: [], problems: [] };
  const [head, ...body] = lines;
  if (head === undefined) return grid;
  const separator = head.includes("\t") ? "\t" : ";";
  const byName = new Map(tests.map((test) => [test.name.trim().toLowerCase(), test.id]));
  const seenTests = new Set<string>();
  splitLine(head, separator)
    .slice(1)
    .forEach((name, index) => {
      const column = index + 1;
      const testId = byName.get(name.toLowerCase()) ?? null;
      // A repeated column reads as no test, so its cells are refused at its header.
      const repeated = testId !== null && seenTests.has(testId);
      grid.columns.push({ text: name, testId: repeated ? null : testId });
      if (name === "") {
        grid.problems.push({ kind: "header", column, reason: "empty_test", text: "" });
      } else if (testId === null) {
        const quoted = name.length > QUOTE_MAX ? `${name.slice(0, QUOTE_MAX)}…` : name;
        grid.problems.push({ kind: "header", column, reason: "unknown_test", text: quoted });
      } else if (repeated) {
        grid.problems.push({ kind: "header", column, reason: "repeated_test", text: "" });
      } else {
        seenTests.add(testId);
      }
    });
  const seenSamples = new Set<string>();
  body.forEach((line, index) => {
    const row = index + 1;
    const [sampleNumber = "", ...cells] = splitLine(line, separator);
    grid.samples.push({ sampleNumber, cells });
    if (
      sampleNumber === "" ||
      sampleNumber.length > SAMPLE_NUMBER_MAX ||
      CONTROL_OR_FORMAT.test(sampleNumber)
    ) {
      grid.problems.push({ kind: "row", row, reason: "sample_number" });
      return;
    }
    if (seenSamples.has(sampleNumber.toLowerCase())) {
      grid.problems.push({ kind: "row", row, reason: "repeated_sample" });
      return;
    }
    seenSamples.add(sampleNumber.toLowerCase());
    if (cells.length > grid.columns.length) {
      grid.problems.push({ kind: "row", row, reason: "columns" });
      return;
    }
    cells.forEach((value, cellIndex) => {
      if (value === "") return;
      const column = cellIndex + 1;
      if (parseDecimal(value) === null) {
        grid.problems.push({ kind: "cell", row, column, reason: "number" });
        return;
      }
      const testId = grid.columns[cellIndex]?.testId;
      // A cell under a header that does not read is refused at that header.
      if (testId === null || testId === undefined) return;
      grid.rows.push({ sampleNumber, testId, value });
    });
  });
  return grid;
}
