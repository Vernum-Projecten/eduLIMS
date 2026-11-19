// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The teacher's and the student's reads of simulations and labs (D10, D11, S10). Every read starts
// from the session user's own rows in SQL: a teacher row of the simulation, or the student's
// place in a lab. Another teacher's simulation and a lab the student is not in read as nothing.
import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import { parseLabId, parseSimulationId } from "../../lib/simulations.ts";
import type { DB } from "../db/schema.gen.ts";
import { studentLabsQuery } from "./student-access.ts";

/** One simulation of the teacher's list. */
export interface TeacherSimulationRow {
  id: string;
  name: string;
  createdAt: string;
  labs: number;
  members: number;
  teachers: number;
}

/** Returns the simulations the teacher teaches, newest first (D11). */
export async function listTeacherSimulations(
  db: Kysely<DB>,
  userId: string,
): Promise<TeacherSimulationRow[]> {
  const rows = await db
    .selectFrom("simulations as s")
    .innerJoin("simulation_teachers as mine", "mine.simulation_id", "s.id")
    .select((eb) => [
      "s.id",
      "s.name",
      "s.created_at",
      eb
        .selectFrom("labs")
        .select((lb) => lb.fn.countAll<string>().as("n"))
        .whereRef("labs.simulation_id", "=", "s.id")
        .as("labs"),
      eb
        .selectFrom("lab_members")
        .select((mb) => mb.fn.countAll<string>().as("n"))
        .whereRef("lab_members.simulation_id", "=", "s.id")
        .as("members"),
      eb
        .selectFrom("simulation_teachers as t")
        .select((tb) => tb.fn.countAll<string>().as("n"))
        .whereRef("t.simulation_id", "=", "s.id")
        .as("teachers"),
    ])
    .where("mine.user_id", "=", userId)
    .orderBy("s.created_at", "desc")
    .orderBy("s.id", "desc")
    .execute();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at.toISOString(),
    labs: Number(row.labs ?? 0),
    members: Number(row.members ?? 0),
    teachers: Number(row.teachers ?? 0),
  }));
}

/** The teacher's page of one simulation: its labs and its teachers. */
export interface TeacherSimulationPage {
  id: string;
  name: string;
  createdAt: string;
  teachers: { userId: string; name: string; email: string }[];
  labs: { id: string; name: string; members: number; waiting: number }[];
}

/**
 * Returns the page of a simulation the teacher teaches, or `null` for a malformed id, an unknown
 * simulation and another teacher's simulation alike (D11, R-01).
 */
export async function getTeacherSimulation(
  db: Kysely<DB>,
  userId: string,
  simulationId: string,
): Promise<TeacherSimulationPage | null> {
  const id = parseSimulationId(simulationId);
  if (id === null) return null;
  const simulation = await db
    .selectFrom("simulations as s")
    .innerJoin("simulation_teachers as mine", "mine.simulation_id", "s.id")
    .select(["s.id", "s.name", "s.created_at"])
    .where("s.id", "=", id)
    .where("mine.user_id", "=", userId)
    .executeTakeFirst();
  if (!simulation) return null;
  const [teachers, labs] = await Promise.all([
    db
      .selectFrom("simulation_teachers as t")
      .innerJoin("user", "user.id", "t.user_id")
      .select(["user.id", "user.name", "user.email"])
      .where("t.simulation_id", "=", id)
      .orderBy("user.name")
      .orderBy("user.id")
      .execute(),
    db
      .selectFrom("labs")
      .select((eb) => [
        "labs.id",
        "labs.name",
        eb
          .selectFrom("lab_members")
          .select((mb) => mb.fn.countAll<string>().as("n"))
          .whereRef("lab_members.lab_id", "=", "labs.id")
          .as("members"),
        eb
          .selectFrom("lab_member_emails")
          .select((wb) => wb.fn.countAll<string>().as("n"))
          .whereRef("lab_member_emails.lab_id", "=", "labs.id")
          .as("waiting"),
      ])
      .where("labs.simulation_id", "=", id)
      .orderBy("labs.name")
      .orderBy("labs.id")
      .execute(),
  ]);
  return {
    id: simulation.id,
    name: simulation.name,
    createdAt: simulation.created_at.toISOString(),
    teachers: teachers.map((row) => ({ userId: row.id, name: row.name, email: row.email })),
    labs: labs.map((row) => ({
      id: row.id,
      name: row.name,
      members: Number(row.members ?? 0),
      waiting: Number(row.waiting ?? 0),
    })),
  };
}

/** The teacher's page of one lab: its members, its waiting addresses and the other labs. */
export interface TeacherLabPage {
  id: string;
  name: string;
  simulation: { id: string; name: string };
  members: { userId: string; name: string; email: string; joinedVia: string; joinedAt: string }[];
  waiting: { email: string; addedAt: string }[];
  /** The other labs of the simulation, the targets of a move. */
  otherLabs: { id: string; name: string }[];
}

/**
 * Returns the page of a lab whose simulation the teacher teaches, or `null` for a malformed id,
 * an unknown lab and a lab of another teacher's simulation alike (D11, R-01).
 */
export async function getTeacherLab(
  db: Kysely<DB>,
  userId: string,
  labId: string,
): Promise<TeacherLabPage | null> {
  const id = parseLabId(labId);
  if (id === null) return null;
  const lab = await db
    .selectFrom("labs")
    .innerJoin("simulations as s", "s.id", "labs.simulation_id")
    .innerJoin("simulation_teachers as mine", "mine.simulation_id", "s.id")
    .select(["labs.id", "labs.name", "s.id as simulation_id", "s.name as simulation_name"])
    .where("labs.id", "=", id)
    .where("mine.user_id", "=", userId)
    .executeTakeFirst();
  if (!lab) return null;
  const [members, waiting, otherLabs] = await Promise.all([
    db
      .selectFrom("lab_members")
      .innerJoin("user", "user.id", "lab_members.user_id")
      .select([
        "user.id",
        "user.name",
        "user.email",
        "lab_members.joined_via",
        "lab_members.joined_at",
      ])
      .where("lab_members.lab_id", "=", id)
      .orderBy("user.name")
      .orderBy("user.id")
      .execute(),
    db
      .selectFrom("lab_member_emails")
      .select(["email", "added_at"])
      .where("lab_id", "=", id)
      .orderBy("email")
      .execute(),
    db
      .selectFrom("labs")
      .select(["id", "name"])
      .where("simulation_id", "=", lab.simulation_id)
      .where("id", "<>", id)
      .orderBy("name")
      .orderBy("id")
      .execute(),
  ]);
  return {
    id: lab.id,
    name: lab.name,
    simulation: { id: lab.simulation_id, name: lab.simulation_name },
    members: members.map((row) => ({
      userId: row.id,
      name: row.name,
      email: row.email,
      joinedVia: row.joined_via,
      joinedAt: row.joined_at.toISOString(),
    })),
    waiting: waiting.map((row) => ({ email: row.email, addedAt: row.added_at.toISOString() })),
    otherLabs: otherLabs.map((row) => ({ id: row.id, name: row.name })),
  };
}

/** One lab of the student's overview. */
export interface StudentLabRow {
  labId: string;
  labName: string;
  simulationId: string;
  simulationName: string;
}

/** Returns the labs the student is a member of, one per simulation (S10). */
export async function listStudentLabs(db: Kysely<DB>, userId: string): Promise<StudentLabRow[]> {
  const rows = await studentLabsQuery(db, userId)
    .innerJoin("simulations", "simulations.id", "labs.simulation_id")
    .select([
      "labs.id as lab_id",
      "labs.name as lab_name",
      "simulations.id as simulation_id",
      "simulations.name as simulation_name",
    ])
    .orderBy("simulations.created_at", "desc")
    .orderBy("simulations.id")
    .execute();
  return rows.map((row) => ({
    labId: row.lab_id,
    labName: row.lab_name,
    simulationId: row.simulation_id,
    simulationName: row.simulation_name,
  }));
}
