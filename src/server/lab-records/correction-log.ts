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
  /**
   * The record it is about, named for the teacher (maintainer, 2026-11-20): a patient by its
   * fictional name (S11), a request by the lab numbers of its samples in the order recorded.
   */
  target:
    | { kind: "patient"; patientId: string; name: string }
    | { kind: "request"; requestId: string; labNumbers: string[] };
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
  row: { patient_id: string | null; patient_name: string | null; request_id: string | null },
  labNumbers: ReadonlyMap<string, string[]>,
): CorrectionEntry["target"] {
  if (row.patient_id !== null && row.patient_name !== null) {
    return { kind: "patient", patientId: row.patient_id, name: row.patient_name };
  }
  if (row.request_id !== null) {
    return {
      kind: "request",
      requestId: row.request_id,
      labNumbers: labNumbers.get(row.request_id) ?? [],
    };
  }
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
          .leftJoin("patients", "patients.id", "record_corrections.patient_id")
          .select([
            "record_corrections.id",
            "record_corrections.lab_id",
            "labs.name as lab_name",
            "record_corrections.patient_id",
            "patients.name as patient_name",
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
  const shown = rows.slice(0, CORRECTION_LOG_MAX);
  const requestIds = shown.flatMap((row) => (row.request_id === null ? [] : [row.request_id]));
  const samples =
    requestIds.length === 0
      ? []
      : await db
          .selectFrom("samples")
          .select(["request_id", "lab_number"])
          .where("request_id", "in", [...new Set(requestIds)])
          .orderBy("created_at")
          .orderBy("id")
          .execute();
  const labNumbers = new Map<string, string[]>();
  for (const sample of samples) {
    labNumbers.set(sample.request_id, [
      ...(labNumbers.get(sample.request_id) ?? []),
      sample.lab_number,
    ]);
  }
  const entries: CorrectionEntry[] = [];
  for (const row of shown) {
    // The left join gives one row of nulls for a simulation without corrections.
    if (row.id === null) continue;
    if (row.lab_id === null || row.lab_name === null || row.corrected_at === null) {
      throw new Error("the database holds a correction without its lab");
    }
    const target = correctionTarget(row, labNumbers);
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
