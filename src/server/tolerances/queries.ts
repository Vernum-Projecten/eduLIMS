// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The reads of a team's tolerances (S13, #269). A student reads only their own lab's, through
// the lab predicate on the session user (S10, R-01); a teacher reads a lab of a simulation they
// teach, through its teacher rows (D10, D11). Neither read selects a correct value or an accuracy
// limit (Q-SIM-1), and the student's read carries nothing of another lab.
import "@tanstack/react-start/server-only";
import { type Kysely, sql } from "kysely";
import { parseLabId, type SimulationState } from "../../lib/simulations.ts";
import { hasRole } from "../authz.ts";
import type { DB } from "../db/schema.gen.ts";
import { AuthError } from "../middleware.ts";
import { assertTeacher, logNotFound, type SimulationActor } from "../simulations/access.ts";
import { toSimulationState } from "../simulations/state.ts";
import { studentLabsQuery } from "../simulations/student-access.ts";

/**
 * Refuses a caller without the app role student. The middleware checks first; this keeps each
 * read and write safe on its own.
 *
 * @throws AuthError 403 without the app role student.
 */
export function assertStudent(actor: Pick<SimulationActor, "roles">): void {
  if (!hasRole(actor, "student")) throw new AuthError(403);
}

/** One test on the student's tolerance page, with the lab's current tolerance or `null`. */
export interface ToleranceEntry {
  testId: string;
  name: string;
  unit: string | null;
  lower: string | null;
  upper: string | null;
  setAt: string | null;
}

/** The tolerance page of the student's own lab (S13). */
export interface StudentTolerancesPage {
  labId: string;
  labName: string;
  simulationName: string;
  state: SimulationState;
  tests: ToleranceEntry[];
}

/** One stored tolerance of a lab, for its teachers: every change is a row (S13). */
export interface ToleranceChange {
  id: string;
  testId: string;
  testName: string;
  unit: string | null;
  lower: string;
  upper: string;
  setAt: string;
  /** Whether this row is the tolerance in force: the newest of its lab and test. */
  current: boolean;
}

/**
 * Returns the current tolerance of every test of the lab, as a lateral join on the newest row of
 * each test. A retired test shows only when the lab has a tolerance for it.
 */
async function currentTolerances(db: Kysely<DB>, labId: string): Promise<ToleranceEntry[]> {
  const rows = await db
    .selectFrom("catalogue_tests as t")
    .leftJoinLateral(
      (eb) =>
        eb
          .selectFrom("lab_tolerances as lt")
          .select([
            sql<string>`lt.lower_limit::text`.as("lower"),
            sql<string>`lt.upper_limit::text`.as("upper"),
            "lt.set_at",
          ])
          .whereRef("lt.test_id", "=", "t.id")
          .where("lt.lab_id", "=", labId)
          .orderBy("lt.set_at", "desc")
          .orderBy("lt.id", "desc")
          .limit(1)
          .as("cur"),
      (join) => join.onTrue(),
    )
    .select(["t.id", "t.name", "t.unit", "cur.lower", "cur.upper", "cur.set_at"])
    .where((eb) => eb.or([eb("t.retired_at", "is", null), eb("cur.lower", "is not", null)]))
    .orderBy(sql`lower(t.name)`)
    .orderBy("t.id")
    .execute();
  return rows.map((row) => ({
    testId: row.id,
    name: row.name,
    unit: row.unit,
    lower: row.lower,
    upper: row.upper,
    setAt: row.set_at ? row.set_at.toISOString() : null,
  }));
}

/**
 * Returns the tolerance page of `labId` when the actor is a member of it, or `null` for a
 * malformed id, an unknown lab and another lab alike; every `null` is logged as an `authz_fail`
 * probe (ASVS V16.3.2). The page holds the active catalogue tests with the lab's own current
 * tolerances, and nothing a teacher set (Q-SIM-1, W7).
 *
 * @throws AuthError 403 without the app role student.
 */
export async function readStudentTolerances(
  db: Kysely<DB>,
  actor: SimulationActor,
  labId: string,
): Promise<StudentTolerancesPage | null> {
  assertStudent(actor);
  const id = parseLabId(labId);
  const lab =
    id === null
      ? undefined
      : await studentLabsQuery(db, actor.id)
          .innerJoin("simulations", "simulations.id", "labs.simulation_id")
          .select([
            "labs.id",
            "labs.name",
            "simulations.name as simulation_name",
            "simulations.state",
          ])
          .where("labs.id", "=", id)
          .executeTakeFirst();
  if (!lab) {
    logNotFound(actor.id, "lab", labId);
    return null;
  }
  return {
    labId: lab.id,
    labName: lab.name,
    simulationName: lab.simulation_name,
    state: toSimulationState(lab.state),
    tests: await currentTolerances(db, lab.id),
  };
}

/** How many changes one page of the teacher's history holds (maintainer on #352, S2). */
export const TOLERANCE_CHANGES_PAGE_SIZE = 50;

/** A lab's tolerances for its teachers: the one in force per test, and one page of changes. */
export interface TeacherTolerances {
  /** The tolerance in force of each test, by test name. */
  current: ToleranceChange[];
  /** Every change, newest first, one page at a time. */
  changes: { rows: ToleranceChange[]; page: number; pages: number; total: number };
}

const changeColumns = [
  "lt.id",
  "lt.test_id",
  "t.name",
  "t.unit",
  sql<string>`lt.lower_limit::text`.as("lower"),
  sql<string>`lt.upper_limit::text`.as("upper"),
  "lt.set_at",
  sql<string>`row_number() over (partition by lt.test_id order by lt.set_at desc, lt.id desc)`.as(
    "rank",
  ),
] as const;

function toChange(row: {
  id: string;
  test_id: string;
  name: string;
  unit: string | null;
  lower: string;
  upper: string;
  set_at: Date;
  rank: string;
}): ToleranceChange {
  return {
    id: row.id,
    testId: row.test_id,
    testName: row.name,
    unit: row.unit,
    lower: row.lower,
    upper: row.upper,
    setAt: row.set_at.toISOString(),
    current: Number(row.rank) === 1,
  };
}

/**
 * Returns a lab of a simulation the actor teaches with its tolerance in force per test and page
 * `page` (from 1) of its changes, newest first, each marked when it is in force (S13: the teacher
 * sees the tolerances and their changes); `null` for a malformed id, an unknown lab and another
 * teacher's lab alike, logged.
 *
 * @throws AuthError 403 without the app role teacher.
 */
export async function readTeacherTolerances(
  db: Kysely<DB>,
  actor: SimulationActor,
  labId: string,
  page = 1,
): Promise<TeacherTolerances | null> {
  assertTeacher(actor);
  const id = parseLabId(labId);
  const lab =
    id === null
      ? undefined
      : await db
          .selectFrom("labs")
          .innerJoin(
            "simulation_teachers",
            "simulation_teachers.simulation_id",
            "labs.simulation_id",
          )
          .select("labs.id")
          .where("labs.id", "=", id)
          .where("simulation_teachers.user_id", "=", actor.id)
          .executeTakeFirst();
  if (!lab) {
    logNotFound(actor.id, "lab", labId);
    return null;
  }
  const ranked = db
    .selectFrom("lab_tolerances as lt")
    .innerJoin("catalogue_tests as t", "t.id", "lt.test_id")
    .select(changeColumns)
    .where("lt.lab_id", "=", lab.id);
  const [current, total, rows] = await Promise.all([
    db
      .selectFrom(ranked.as("r"))
      .selectAll()
      .where("r.rank", "=", "1")
      .orderBy(sql`lower(r.name)`)
      .orderBy("r.test_id")
      .execute(),
    db
      .selectFrom("lab_tolerances")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("lab_id", "=", lab.id)
      .executeTakeFirstOrThrow(),
    ranked
      .orderBy("lt.set_at", "desc")
      .orderBy("lt.id", "desc")
      .limit(TOLERANCE_CHANGES_PAGE_SIZE)
      .offset((page - 1) * TOLERANCE_CHANGES_PAGE_SIZE)
      .execute(),
  ]);
  const count = Number(total.n);
  return {
    current: current.map(toChange),
    changes: {
      rows: rows.map(toChange),
      page,
      pages: Math.max(1, Math.ceil(count / TOLERANCE_CHANGES_PAGE_SIZE)),
      total: count,
    },
  };
}
