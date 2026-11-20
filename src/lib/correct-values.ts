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

/** A test a pasted line may name: its id and its name in the catalogue. */
export interface PasteTest {
  id: string;
  name: string;
}

/** One pasted line that reads as a correct value. */
export interface PastedRow {
  sampleNumber: string;
  testId: string;
  value: string;
}

/** Why a pasted line does not read, with its line number (from 1) and, for a test, its text. */
export interface PasteProblem {
  line: number;
  reason: "columns" | "unknown_test" | "sample_number" | "number" | "repeated";
  text: string;
}

/** How much of an unknown test name a problem quotes, so the teacher finds the line. */
const QUOTE_MAX = 40;

/**
 * Reads pasted lines of a sample number, a test name and a value, separated by a tab (a copied
 * spreadsheet) or a semicolon; a comma stays free for the decimal separator. A test is matched
 * by its name regardless of case. Blank lines are skipped; every other line becomes a row or a
 * problem, never both. The values are left as typed for the schema to check and convert.
 */
export function parsePastedRows(
  text: string,
  tests: readonly PasteTest[],
): { rows: PastedRow[]; problems: PasteProblem[] } {
  const byName = new Map(tests.map((test) => [test.name.trim().toLowerCase(), test.id]));
  const rows: PastedRow[] = [];
  const problems: PasteProblem[] = [];
  const seen = new Set<string>();
  text.split(/\r\n|\r|\n/).forEach((raw, index) => {
    const line = index + 1;
    if (raw.trim() === "") return;
    const cells = raw.split(raw.includes("\t") ? "\t" : ";").map((cell) => cell.trim());
    const [sampleNumber = "", testName = "", value = ""] = cells;
    if (cells.length !== 3) {
      problems.push({ line, reason: "columns", text: "" });
      return;
    }
    if (
      sampleNumber === "" ||
      sampleNumber.length > SAMPLE_NUMBER_MAX ||
      CONTROL_OR_FORMAT.test(sampleNumber)
    ) {
      problems.push({ line, reason: "sample_number", text: "" });
      return;
    }
    const testId = byName.get(testName.toLowerCase());
    if (testId === undefined) {
      const quoted = testName.length > QUOTE_MAX ? `${testName.slice(0, QUOTE_MAX)}…` : testName;
      problems.push({ line, reason: "unknown_test", text: quoted });
      return;
    }
    if (parseDecimal(value) === null) {
      problems.push({ line, reason: "number", text: "" });
      return;
    }
    const key = `${sampleNumber.toLowerCase()}\u0000${testId}`;
    if (seen.has(key)) {
      problems.push({ line, reason: "repeated", text: "" });
      return;
    }
    seen.add(key);
    rows.push({ sampleNumber, testId, value });
  });
  return { rows, problems };
}
