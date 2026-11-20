// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The teacher's read of the correction log (S11, S12; maintainer, 2026-11-19 on #268): every
// correction a lab made to a patient or a request of one simulation, newest first. Only a teacher
// of the simulation reads it, through the teacher row in the same query (D10, D11).
import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import { parseSimulationId } from "../../lib/simulations.ts";
import type { DB } from "../db/schema.gen.ts";
import { assertTeacher, logNotFound, type SimulationActor } from "../simulations/access.ts";
import { type CorrectionChange, correctionChangesSchema } from "./corrections.ts";

/**
 * The most corrections one read returns, newest first. No requirement sets a number: our own
 * design (#268), well above what six students correct in a simulation.
 */
export const CORRECTION_LOG_MAX = 500;

/** One correction as the teacher reads it. */
export interface CorrectionEntry {
  id: string;
  labId: string;
  labName: string;
  target: { kind: "patient"; patientId: string } | { kind: "request"; requestId: string };
  /** The name of the student who corrected, or `null` when the account is gone. */
  correctedBy: string | null;
  /** ISO 8601, from the database clock. */
  correctedAt: string;
  changes: CorrectionChange[];
}

/** The correction log of one simulation, with the names of the tests its changes name. */
export interface CorrectionLog {
  simulationId: string;
  entries: CorrectionEntry[];
  /** Whether older corrections exist beyond {@link CORRECTION_LOG_MAX}. */
  truncated: boolean;
  testNames: Record<string, string>;
}

/** Returns what a correction is about; the `record_corrections_target` CHECK holds exactly one. */
function correctionTarget(
  patientId: string | null,
  requestId: string | null,
): CorrectionEntry["target"] {
  if (patientId !== null) return { kind: "patient", patientId };
  if (requestId !== null) return { kind: "request", requestId };
  throw new Error("the database holds a correction about nothing");
}

/**
 * Returns the correction log of a simulation the actor teaches, or `null` for a malformed id, an
 * unknown simulation and another teacher's alike, logged.
 *
 * @throws AuthError 403 without the app role teacher.
 */
export async function readCorrectionLog(
  db: Kysely<DB>,
  actor: SimulationActor,
  simulationId: string,
): Promise<CorrectionLog | null> {
  assertTeacher(actor);
  const id = parseSimulationId(simulationId);
  const rows =
    id === null
      ? null
      : await db
          .selectFrom("simulations")
          .innerJoin("simulation_teachers", "simulation_teachers.simulation_id", "simulations.id")
          .leftJoin("record_corrections", "record_corrections.simulation_id", "simulations.id")
          .leftJoin("labs", "labs.id", "record_corrections.lab_id")
          .leftJoin("user", "user.id", "record_corrections.corrected_by")
          .select([
            "record_corrections.id",
            "record_corrections.lab_id",
            "labs.name as lab_name",
            "record_corrections.patient_id",
            "record_corrections.request_id",
            "record_corrections.corrected_at",
            "record_corrections.changes",
            "user.name as corrected_by",
          ])
          .where("simulations.id", "=", id)
          .where("simulation_teachers.user_id", "=", actor.id)
          .orderBy("record_corrections.corrected_at", "desc")
          .orderBy("record_corrections.id", "desc")
          .limit(CORRECTION_LOG_MAX + 1)
          .execute();
  if (rows === null || rows.length === 0) {
    logNotFound(actor.id, "simulation", simulationId);
    return null;
  }
  const entries: CorrectionEntry[] = [];
  for (const row of rows.slice(0, CORRECTION_LOG_MAX)) {
    // The left join gives one row of nulls for a simulation without corrections.
    if (row.id === null) continue;
    if (row.lab_id === null || row.lab_name === null || row.corrected_at === null) {
      throw new Error("the database holds a correction without its lab");
    }
    const target = correctionTarget(row.patient_id, row.request_id);
    entries.push({
      id: row.id,
      labId: row.lab_id,
      labName: row.lab_name,
      target,
      correctedBy: row.corrected_by,
      correctedAt: row.corrected_at.toISOString(),
      changes: correctionChangesSchema.parse(row.changes),
    });
  }
  const testIds = [
    ...new Set(
      entries.flatMap((entry) =>
        entry.changes.flatMap((change) =>
          change.field === "tests" ? [...change.before, ...change.after] : [],
        ),
      ),
    ),
  ];
  const tests =
    testIds.length === 0
      ? []
      : await db
          .selectFrom("catalogue_tests")
          .select(["id", "name"])
          .where("id", "in", testIds)
          .execute();
  return {
    simulationId,
    entries,
    truncated: rows.length > CORRECTION_LOG_MAX,
    testNames: Object.fromEntries(tests.map((test) => [test.id, test.name])),
  };
}
