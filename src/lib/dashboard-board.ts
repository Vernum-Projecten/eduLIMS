// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The shape of the teacher dashboard's board (D11, #271): teacher-scoped only, since a column
// carries the correct value and the limits (Q-SIM-1). No `@/` imports.
import type { AccuracyLimits, CorrectValue } from "./correct-values.ts";
import type { AccuracyStatus } from "./dashboard.ts";

/** One column of the board: a sample number and a test of the answer model (#401). */
export interface BoardColumn {
  key: string;
  sampleNumber: string;
  testId: string;
  testName: string;
  unit: string | null;
  correctValue: CorrectValue;
  /** The teacher's limits of the test (D13); `null` while none are set. */
  limits: AccuracyLimits | null;
}

interface CellBase {
  /** The {@link BoardColumn.key} of the cell's column. */
  key: string;
  requestId: string;
  /** The server's time of entry of the request (Q-SIM-2). */
  enteredAt: string;
  /**
   * The tests the team recorded as not offered on the request (#398), as written; `null` while
   * eduLIMS does not record them.
   */
  notOffered: readonly string[] | null;
}

/** A cell of a lab the team requested: open, measured but not released, or released. */
export type BoardCell =
  | (CellBase & { state: "open" })
  | (CellBase & { state: "measured" })
  | (CellBase & {
      state: "released";
      /** The released value as stored. */
      value: string;
      /** The server's time of release (Q-SIM-2). */
      releasedAt: string;
      /** G-01. */
      turnaroundMs: number;
      /** G-03; `null` when the test has no limits or a number is out of bounds. */
      status: AccuracyStatus | null;
    });

/** One lab's row: its cells (only the requested ones) and its summary. */
export interface BoardLab {
  labId: string;
  name: string;
  logoVersion: string | null;
  cells: readonly BoardCell[];
  summary: {
    green: number;
    yellow: number;
    red: number;
    released: number;
    requested: number;
    /** G-01 per team: the median over the released cells; `null` before the first. */
    medianTurnaroundMs: number | null;
  };
  /** The tests the team recorded as not offered (#398); `null` while eduLIMS records none. */
  notOffered: number | null;
}

/** The dashboard's read: the board of the running simulation, or why there is none. */
export type TeacherDashboard =
  | { kind: "none" }
  | { kind: "not_taught" }
  | {
      kind: "running";
      simulation: { id: string; name: string; startedAt: string };
      /** The server's time of the read: open cells count from it, never the browser's clock. */
      readAt: string;
      columns: readonly BoardColumn[];
      labs: readonly BoardLab[];
    };
