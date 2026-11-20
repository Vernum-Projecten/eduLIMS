// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Shared set-up of the simulation service's database tests: invented @example.test people with
// an app role, and a world of two simulations whose labs hold six students where it matters.
import type { Kysely } from "kysely";
import { expect } from "vitest";
import { formatRoles, type Role } from "../../lib/roles.ts";
import { newId } from "../db/ids.ts";
import type { DB } from "../db/schema.gen.ts";
import { setSecurityLogWriter } from "../security-log.ts";
import type { ProbeTarget, SimulationActor } from "./access.ts";
import { createLab } from "./labs.ts";
import { createSimulation } from "./simulations.ts";

export const NOW = new Date("2026-11-19T09:00:00Z");

/** A test person: an actor with an address. */
export type Person = SimulationActor & { email: string };

/** Creates a person with `roles` and a verified address and returns them as an actor. */
export async function person(
  db: Kysely<DB>,
  key: string,
  roles: readonly Role[],
  options: { verified?: boolean } = {},
): Promise<Person> {
  const id = newId();
  const email = `${key}@example.test`;
  await db
    .insertInto("user")
    .values({
      id,
      name: `Test ${key}`,
      email,
      emailVerified: options.verified ?? true,
      role: formatRoles(roles),
    })
    .execute();
  return { id, roles, email };
}

/** Puts `userId` in a lab, bypassing the service (test set-up only). */
export async function place(
  db: Kysely<DB>,
  simulationId: string,
  labId: string,
  userId: string,
): Promise<void> {
  await db
    .insertInto("lab_members")
    .values({ simulation_id: simulationId, lab_id: labId, user_id: userId, joined_via: "email" })
    .execute();
}

async function simulationOf(db: Kysely<DB>, teacher: Person, name: string): Promise<string> {
  const created = await createSimulation(db, teacher, { name }, NOW);
  if (!created.ok) throw new Error(created.error);
  return created.value.simulationId;
}

async function labOf(db: Kysely<DB>, teacher: Person, simulationId: string, name: string) {
  const created = await createLab(db, teacher, { simulationId, name }, NOW);
  if (!created.ok) throw new Error(created.error);
  return created.value.labId;
}

/**
 * Two simulations and the people of every negative case (S10, D10, D11, B5):
 *
 * - `teacher` created `simulationId`, and `coTeacher` teaches it too; it has `labId` with six
 *   students (`student` first among them) and `otherLabId` with `otherLabStudent`;
 * - `outsiderTeacher` teaches only `outsideSimulationId`, whose `outsideLabId` holds
 *   `outsideStudent`, a student outside the first simulation;
 * - `admin` holds the admin role only, and `stranger` is a student in no lab.
 */
export async function world(db: Kysely<DB>) {
  const teacher = await person(db, "teacher", ["teacher"]);
  const coTeacher = await person(db, "co-teacher", ["teacher"]);
  const outsiderTeacher = await person(db, "outsider-teacher", ["teacher"]);
  const admin = await person(db, "admin", ["admin"]);
  const simulationId = await simulationOf(db, teacher, "Practice simulation");
  await db
    .insertInto("simulation_teachers")
    .values({ simulation_id: simulationId, user_id: coTeacher.id, added_by: teacher.id })
    .execute();
  const labId = await labOf(db, teacher, simulationId, "Pipette Pilots");
  const otherLabId = await labOf(db, teacher, simulationId, "Blue Cuvettes");
  const labStudents: Person[] = [];
  for (const n of [1, 2, 3, 4, 5, 6]) {
    const student = await person(db, `student-${n}`, ["student"]);
    await place(db, simulationId, labId, student.id);
    labStudents.push(student);
  }
  const [student] = labStudents;
  if (!student) throw new Error("no student");
  const otherLabStudent = await person(db, "other-lab-student", ["student"]);
  await place(db, simulationId, otherLabId, otherLabStudent.id);
  const outsideSimulationId = await simulationOf(db, outsiderTeacher, "Other simulation");
  const outsideLabId = await labOf(db, outsiderTeacher, outsideSimulationId, "Lab Osprey");
  const outsideStudent = await person(db, "outside-student", ["student"]);
  await place(db, outsideSimulationId, outsideLabId, outsideStudent.id);
  const stranger = await person(db, "stranger", ["student"]);
  return {
    teacher,
    coTeacher,
    outsiderTeacher,
    admin,
    simulationId,
    labId,
    otherLabId,
    labStudents,
    student,
    otherLabStudent,
    outsideSimulationId,
    outsideLabId,
    outsideStudent,
    stranger,
  };
}

/** The world {@link world} builds. */
export type World = Awaited<ReturnType<typeof world>>;

/** Returns the activity-log rows of an action, oldest first. */
export function auditRows(db: Kysely<DB>, action: string) {
  return db
    .selectFrom("audit_event")
    .select(["actor_id", "outcome", "target_type", "target_id", "reason_code", "metadata"])
    .where("action", "=", action)
    .orderBy("occurred_at")
    .orderBy("id")
    .execute();
}

/** Captures the security stream (stdout) while `run` runs and returns its parsed lines. */
export async function securityLines(
  run: () => Promise<unknown>,
): Promise<Record<string, unknown>[]> {
  const lines: string[] = [];
  const restore = setSecurityLogWriter((line) => lines.push(line));
  try {
    await run();
  } finally {
    restore();
  }
  return lines.map((line): Record<string, unknown> => JSON.parse(line));
}

/** The `authz_fail` line `logNotFound` writes for `actorId` asking for a simulation or lab. */
export function notFoundLine(actorId: string, type: ProbeTarget, id: string) {
  return expect.objectContaining({
    event: "authz_fail",
    level: "warn",
    actor_id: actorId,
    target_type: type,
    target_id: id,
    status: 404,
  });
}
