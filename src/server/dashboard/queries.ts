// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The teacher dashboard's read (D11, D13, G-01, G-03, #271, #386). One simulation runs at a time,
// and the board shows it to the teachers it has: the teacher row of the session user is part of
// the query, so anyone else reads nothing of it. The data comes from the eduLIMS database (the
// times, the released values, the correct values and the limits); FerroEHR is not read.
import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import { type AccuracyLimits, asCorrectValue, parseLimitKind } from "../../lib/correct-values.ts";
import { accuracyStatus, median, turnaroundMs } from "../../lib/dashboard.ts";
import type {
  BoardCell,
  BoardColumn,
  BoardLab,
  TeacherDashboard,
} from "../../lib/dashboard-board.ts";
import type { DB } from "../db/schema.gen.ts";
import { assertTeacher, type SimulationActor } from "../simulations/access.ts";
import { type NotOfferedSource, notOfferedNone } from "./not-offered.ts";

/**
 * The key of a board column: the test and the sample number regardless of case. The test id is
 * a UUID of fixed length, so the key is unambiguous without a separator the wire could change.
 */
export function columnKey(sampleNumber: string, testId: string): string {
  return `${testId}:${sampleNumber.toLowerCase()}`;
}

function logoVersion(sha256: Buffer | null): string | null {
  return sha256 === null ? null : sha256.toString("hex").slice(0, 16);
}

function limitsOf(row: {
  kind: string | null;
  yellow_limit: string | null;
  red_limit: string | null;
}): AccuracyLimits | null {
  const kind = parseLimitKind(row.kind);
  if (kind === undefined || row.yellow_limit === null || row.red_limit === null) return null;
  return { kind, yellow: row.yellow_limit, red: row.red_limit };
}

/** The answer model of a simulation (#401): its correct values with their tests and limits. */
async function readColumns(db: Kysely<DB>, simulationId: string): Promise<BoardColumn[]> {
  const rows = await db
    .selectFrom("correct_values as cv")
    .innerJoin("catalogue_tests as t", "t.id", "cv.test_id")
    .leftJoin("simulation_test_limits as l", (join) =>
      join.onRef("l.simulation_id", "=", "cv.simulation_id").onRef("l.test_id", "=", "cv.test_id"),
    )
    .select([
      "cv.sample_number",
      "cv.test_id",
      "cv.value",
      "t.name",
      "t.unit",
      "l.kind",
      "l.yellow_limit",
      "l.red_limit",
    ])
    .where("cv.simulation_id", "=", simulationId)
    .orderBy("cv.sample_number")
    .orderBy("t.name")
    .orderBy("cv.test_id")
    .execute();
  return rows.map((row) => ({
    key: columnKey(row.sample_number, row.test_id),
    sampleNumber: row.sample_number,
    testId: row.test_id,
    testName: row.name,
    unit: row.unit,
    correctValue: asCorrectValue(String(row.value)),
    limits: limitsOf(row),
  }));
}

/** One requested test of a sample of a lab, with its measurements and release. */
interface RequestedRow {
  lab_id: string;
  request_id: string;
  entered_at: Date;
  sample_number: string;
  test_id: string;
  released_at: Date | null;
  released_value: string | null;
  measurements: string | null;
}

/**
 * Reads every requested test of every sample in the simulation's labs, with the number of its
 * measurements of that sample and the value it released from that sample, ordered so the first
 * row of a cell is the earliest request (by its time of entry, then id).
 */
function readRequested(db: Kysely<DB>, simulationId: string): Promise<RequestedRow[]> {
  return db
    .selectFrom("requests as r")
    .innerJoin("samples as s", "s.request_id", "r.id")
    .innerJoin("request_tests as rt", "rt.request_id", "r.id")
    .leftJoin("measurements as released", (join) =>
      join
        .onRef("released.id", "=", "rt.released_measurement_id")
        .onRef("released.sample_id", "=", "s.id"),
    )
    .select((eb) => [
      "r.lab_id",
      "r.id as request_id",
      "r.entered_at",
      "s.sample_number",
      "rt.test_id",
      "rt.released_at",
      eb.cast<string | null>("released.value", "text").as("released_value"),
      eb
        .selectFrom("measurements as m")
        .select((mb) => mb.fn.countAll<string>().as("n"))
        .whereRef("m.request_id", "=", "r.id")
        .whereRef("m.test_id", "=", "rt.test_id")
        .whereRef("m.sample_id", "=", "s.id")
        .as("measurements"),
    ])
    .where("r.simulation_id", "=", simulationId)
    .orderBy("r.entered_at")
    .orderBy("r.id")
    .orderBy("s.id")
    .execute();
}

function cellOf(
  row: RequestedRow,
  column: BoardColumn,
  notOffered: readonly string[] | null,
): BoardCell {
  const enteredAt = row.entered_at.toISOString();
  const base = { key: column.key, requestId: row.request_id, enteredAt, notOffered };
  if (row.released_at !== null && row.released_value !== null) {
    const releasedAt = row.released_at.toISOString();
    return {
      ...base,
      state: "released",
      value: row.released_value,
      releasedAt,
      turnaroundMs: turnaroundMs(enteredAt, releasedAt),
      status:
        column.limits === null
          ? null
          : accuracyStatus(row.released_value, column.correctValue, column.limits),
    };
  }
  return { ...base, state: Number(row.measurements ?? 0) > 0 ? "measured" : "open" };
}

/** Returns the summary of a lab's cells: the colours, released of requested, the median (G-01). */
function summaryOf(cells: readonly BoardCell[]): BoardLab["summary"] {
  const released = cells.flatMap((cell) => (cell.state === "released" ? [cell] : []));
  const count = (status: string) => released.filter((cell) => cell.status === status).length;
  return {
    green: count("green"),
    yellow: count("yellow"),
    red: count("red"),
    released: released.length,
    requested: cells.length,
    medianTurnaroundMs: median(released.map((cell) => cell.turnaroundMs)),
  };
}

/**
 * Returns the teacher dashboard: the running simulation's board when the actor teaches it,
 * `none` when no simulation runs, and `not_taught` when one runs that the actor does not teach,
 * without its name. A lab's cell for a sample and test is its earliest request that has both;
 * a request for a sample or test outside the answer model has no column.
 *
 * @param now - The server's time of the read, which the screen counts open cells from.
 * @throws AuthError 403 without the app role teacher.
 */
export async function readTeacherDashboard(
  db: Kysely<DB>,
  actor: SimulationActor,
  now: Date,
  notOfferedSource: NotOfferedSource = notOfferedNone,
): Promise<TeacherDashboard> {
  assertTeacher(actor);
  const running = await db
    .selectFrom("simulations as s")
    .leftJoin("simulation_teachers as mine", (join) =>
      join.onRef("mine.simulation_id", "=", "s.id").on("mine.user_id", "=", actor.id),
    )
    .select(["s.id", "s.name", "s.started_at", "mine.user_id"])
    .where("s.state", "=", "running")
    .executeTakeFirst();
  if (!running) return { kind: "none" };
  if (running.user_id === null || running.started_at === null) return { kind: "not_taught" };
  const simulationId = running.id;
  const [columns, labs, requested, notOffered] = await Promise.all([
    readColumns(db, simulationId),
    db
      .selectFrom("labs")
      .leftJoin("lab_logos", "lab_logos.lab_id", "labs.id")
      .select(["labs.id", "labs.name", "lab_logos.sha256"])
      .where("labs.simulation_id", "=", simulationId)
      .orderBy("labs.name")
      .orderBy("labs.id")
      .execute(),
    readRequested(db, simulationId),
    notOfferedSource(db, simulationId),
  ]);
  const byKey = new Map(columns.map((column) => [column.key, column]));
  const cells = new Map<string, Map<string, BoardCell>>();
  for (const row of requested) {
    const column = byKey.get(columnKey(row.sample_number, row.test_id));
    if (!column) continue;
    const ofLab = cells.get(row.lab_id) ?? new Map<string, BoardCell>();
    cells.set(row.lab_id, ofLab);
    if (ofLab.has(column.key)) continue;
    const names = notOffered === null ? null : (notOffered.byRequest.get(row.request_id) ?? []);
    ofLab.set(column.key, cellOf(row, column, names));
  }
  return {
    kind: "running",
    simulation: {
      id: simulationId,
      name: running.name,
      startedAt: running.started_at.toISOString(),
    },
    readAt: now.toISOString(),
    columns,
    labs: labs.map((lab) => {
      const ofLab = [...(cells.get(lab.id)?.values() ?? [])];
      return {
        labId: lab.id,
        name: lab.name,
        logoVersion: logoVersion(lab.sha256),
        cells: ofLab,
        summary: summaryOf(ofLab),
        notOffered: notOffered === null ? null : (notOffered.byLab.get(lab.id) ?? 0),
      };
    }),
  };
}
