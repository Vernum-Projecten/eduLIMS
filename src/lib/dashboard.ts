// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The measures of the teacher dashboard (D11, D13, G-01, G-03) as pure functions: the turnaround
// time of a released result, the accuracy status of a released value against the correct value
// and the teacher's limits, the median turnaround of a lab, and the board's order. Values stay
// decimal text and are compared as integers, never as binary floats. No `@/` imports.
import type { AccuracyLimits } from "./correct-values.ts";
import { decimalMillionths, parseDecimal } from "./decimal.ts";

/** The accuracy status of a released result (G-03, D13): green, yellow or red. */
export const ACCURACY_STATUSES = ["green", "yellow", "red"] as const;
export type AccuracyStatus = (typeof ACCURACY_STATUSES)[number];

const MILLION = 1_000_000n;

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}

/**
 * Returns whether `distance` lies within `limit` (D13). For a percentage, the limit is that share
 * of the correct value's size; all four numbers are integers of millionths, so the comparison is
 * exact. A distance exactly on the limit is within it, so it gets the better colour.
 */
function within(distance: bigint, limit: bigint, kind: AccuracyLimits["kind"], correct: bigint) {
  if (kind === "absolute") return distance <= limit;
  // distance <= limit% × |correct|, scaled: d·10⁶ · 100 · 10⁶ <= l·10⁶ · |c|·10⁶.
  return distance * 100n * MILLION <= limit * absolute(correct);
}

/**
 * Returns the accuracy status of a released `value` against the `correct` value and the teacher's
 * `limits` of the test (G-03, D13): green within the yellow limit, yellow within the red limit,
 * red beyond it. A value exactly on a limit gets the better colour. Returns `null` when a number
 * is no decimal within the bounds of `src/lib/decimal.ts`, so an odd value shows as unknown,
 * never as a colour.
 */
export function accuracyStatus(
  value: string,
  correct: string,
  limits: AccuracyLimits,
): AccuracyStatus | null {
  const parts = [value, correct, limits.yellow, limits.red].map((text) => parseDecimal(text));
  const [v, c, yellow, red] = parts;
  if (v == null || c == null || yellow == null || red == null) return null;
  const correctScaled = decimalMillionths(c);
  const distance = absolute(decimalMillionths(v) - correctScaled);
  if (within(distance, decimalMillionths(yellow), limits.kind, correctScaled)) return "green";
  if (within(distance, decimalMillionths(red), limits.kind, correctScaled)) return "yellow";
  return "red";
}

/**
 * Returns the turnaround time of a released result in milliseconds (G-01): from the entry of
 * its request to its release, both instants taken by the server (Q-SIM-2).
 *
 * @throws RangeError when either instant is not a valid date or ISO string.
 */
export function turnaroundMs(enteredAt: string, releasedAt: string): number {
  const start = Date.parse(enteredAt);
  const end = Date.parse(releasedAt);
  if (Number.isNaN(start) || Number.isNaN(end)) throw new RangeError("invalid instant");
  return end - start;
}

/**
 * Returns the median of `values`, or `null` for none. For an even count it is the mean of the
 * two middle values, rounded to a whole millisecond.
 */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  if (sorted.length % 2 === 1) return upper;
  const lower = sorted[middle - 1] ?? upper;
  return Math.round((lower + upper) / 2);
}

/** What the board's order reads of a lab. */
export interface BoardStanding {
  labId: string;
  name: string;
  green: number;
  red: number;
  /** The median turnaround time in milliseconds; `null` before the lab's first release. */
  medianTurnaroundMs: number | null;
}

/** How the board is sorted: by the leaderboard order, or by lab name. */
export const BOARD_SORTS = ["board", "name"] as const;
export type BoardSort = (typeof BOARD_SORTS)[number];

function byName(a: BoardStanding, b: BoardStanding): number {
  const name = a.name.localeCompare(b.name, "en", { sensitivity: "base", numeric: true });
  if (name !== 0) return name;
  return a.labId < b.labId ? -1 : a.labId > b.labId ? 1 : 0;
}

/**
 * Compares two labs in the leaderboard order (owner, 2026-11-20 on #271): most green first, then
 * fewest red, then the shortest median turnaround (a lab without one last), then the lab name,
 * then the id, so the same data always gives the same order.
 */
export function compareStandings(a: BoardStanding, b: BoardStanding): number {
  if (a.green !== b.green) return b.green - a.green;
  if (a.red !== b.red) return a.red - b.red;
  const left = a.medianTurnaroundMs;
  const right = b.medianTurnaroundMs;
  if (left !== right) {
    if (left === null) return 1;
    if (right === null) return -1;
    return left - right;
  }
  return byName(a, b);
}

/**
 * Returns `labs` with their position in the leaderboard order (1 for the first), in the order
 * `sort` asks for. The position is always the leaderboard's, also when sorted by name.
 */
export function orderBoard<T extends BoardStanding>(
  labs: readonly T[],
  sort: BoardSort,
): (T & { position: number })[] {
  const ranked = [...labs]
    .sort(compareStandings)
    .map((lab, index) => ({ ...lab, position: index + 1 }));
  return sort === "board" ? ranked : ranked.sort(byName);
}
