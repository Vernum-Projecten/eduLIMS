// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The teacher's and the student's reads of simulations and labs (D10, D11, S10). Every read starts
// from the session user's own rows in SQL: a teacher row of the simulation, or the student's
// place in a lab. Another teacher's simulation and a lab the student is not in read as nothing.
import "@tanstack/react-start/server-only";
import { type Kysely, sql } from "kysely";
import { parseLabId, parseSimulationId, type SimulationState } from "../../lib/simulations.ts";
import type { DB } from "../db/schema.gen.ts";
import { logNotFound } from "./access.ts";
import { toSimulationState } from "./state.ts";
import { studentLabsQuery } from "./student-access.ts";

/**
 * The version of a lab's logo as the screens put it in the logo's address: the start of its
 * SHA-256, so a replaced logo gets a new address and the browser shows the new image (#293).
 * `null` for a lab without a logo, so a screen asks for no image and gets no 404.
 */
function logoVersion(sha256: Buffer | null): string | null {
  return sha256 === null ? null : sha256.toString("hex").slice(0, 16);
}

/** One simulation of the teacher's list. */
export interface TeacherSimulationRow {
  id: string;
  name: string;
  createdAt: string;
  state: SimulationState;
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
      "s.state",
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
    state: toSimulationState(row.state),
    labs: Number(row.labs ?? 0),
    members: Number(row.members ?? 0),
    teachers: Number(row.teachers ?? 0),
  }));
}

/** The teacher's page of one simulation: its state, its labs and its teachers. */
export interface TeacherSimulationPage {
  id: string;
  name: string;
  createdAt: string;
  state: SimulationState;
  /** When a teacher started it, on the server's clock; `null` while it is prepared. */
  startedAt: string | null;
  /** When a teacher finished it; `null` until then. */
  finishedAt: string | null;
  teachers: { userId: string; name: string; email: string }[];
  labs: {
    id: string;
    name: string;
    members: number;
    waiting: number;
    /** The version of the lab's logo, `null` without one ({@link logoVersion}). */
    logoVersion: string | null;
    /** Whether the lab has a join code, and whether its time or its joins ran out (#288). */
    joinCode: LabJoinCodeState;
  }[];
}

/**
 * The join code of a lab in the simulation's list: none, on, or ended because its time or its
 * joins ran out. The lab's own page says more, such as a code made under a rotated secret.
 */
export type LabJoinCodeState = "off" | "on" | "ended";

function joinCodeState(
  row: {
    expires_at: Date | null;
    uses: number | null;
    max_uses: number | null;
    key_fingerprint: string | null;
  },
  now: Date,
  fingerprint: string,
): LabJoinCodeState {
  if (row.expires_at === null || row.uses === null || row.max_uses === null) return "off";
  // A code made under a rotated secret no longer works (security reviews of #394 and #403).
  const stale = row.key_fingerprint !== fingerprint;
  return stale || row.expires_at <= now || row.uses >= row.max_uses ? "ended" : "on";
}

/**
 * Returns the page of a simulation the teacher teaches, or `null` for a malformed id, an unknown
 * simulation and another teacher's simulation alike (D11, R-01). Every `null` is logged as an
 * `authz_fail` probe (ASVS V16.3.2).
 */
export async function getTeacherSimulation(
  db: Kysely<DB>,
  userId: string,
  simulationId: string,
  now: Date,
  fingerprint: string,
): Promise<TeacherSimulationPage | null> {
  const id = parseSimulationId(simulationId);
  if (id === null) {
    logNotFound(userId, "simulation", simulationId);
    return null;
  }
  const simulation = await db
    .selectFrom("simulations as s")
    .innerJoin("simulation_teachers as mine", "mine.simulation_id", "s.id")
    .select(["s.id", "s.name", "s.created_at", "s.state", "s.started_at", "s.finished_at"])
    .where("s.id", "=", id)
    .where("mine.user_id", "=", userId)
    .executeTakeFirst();
  if (!simulation) {
    logNotFound(userId, "simulation", simulationId);
    return null;
  }
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
      .leftJoin("lab_logos", "lab_logos.lab_id", "labs.id")
      .leftJoin("lab_join_codes", "lab_join_codes.lab_id", "labs.id")
      .select((eb) => [
        "labs.id",
        "labs.name",
        "lab_logos.sha256",
        "lab_join_codes.expires_at",
        "lab_join_codes.uses",
        "lab_join_codes.max_uses",
        "lab_join_codes.key_fingerprint",
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
    state: toSimulationState(simulation.state),
    startedAt: simulation.started_at?.toISOString() ?? null,
    finishedAt: simulation.finished_at?.toISOString() ?? null,
    teachers: teachers.map((row) => ({ userId: row.id, name: row.name, email: row.email })),
    labs: labs.map((row) => ({
      id: row.id,
      name: row.name,
      members: Number(row.members ?? 0),
      waiting: Number(row.waiting ?? 0),
      logoVersion: logoVersion(row.sha256),
      joinCode: joinCodeState(row, now, fingerprint),
    })),
  };
}

/** The teacher's page of one lab: its members, its waiting addresses and the other labs. */
export interface TeacherLabPage {
  id: string;
  name: string;
  simulation: { id: string; name: string };
  /** The version of the lab's logo, `null` without one ({@link logoVersion}). */
  logoVersion: string | null;
  members: { userId: string; name: string; email: string; joinedVia: string; joinedAt: string }[];
  waiting: { email: string; addedAt: string }[];
  /** The other labs of the simulation, the targets of a move. */
  otherLabs: { id: string; name: string }[];
}

/**
 * Returns the page of a lab whose simulation the teacher teaches, or `null` for a malformed id,
 * an unknown lab and a lab of another teacher's simulation alike (D11, R-01). Every `null` is
 * logged as an `authz_fail` probe (ASVS V16.3.2).
 */
export async function getTeacherLab(
  db: Kysely<DB>,
  userId: string,
  labId: string,
): Promise<TeacherLabPage | null> {
  const id = parseLabId(labId);
  if (id === null) {
    logNotFound(userId, "lab", labId);
    return null;
  }
  const lab = await db
    .selectFrom("labs")
    .innerJoin("simulations as s", "s.id", "labs.simulation_id")
    .innerJoin("simulation_teachers as mine", "mine.simulation_id", "s.id")
    .leftJoin("lab_logos", "lab_logos.lab_id", "labs.id")
    .select([
      "labs.id",
      "labs.name",
      "s.id as simulation_id",
      "s.name as simulation_name",
      "lab_logos.sha256",
    ])
    .where("labs.id", "=", id)
    .where("mine.user_id", "=", userId)
    .executeTakeFirst();
  if (!lab) {
    logNotFound(userId, "lab", labId);
    return null;
  }
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
    logoVersion: logoVersion(lab.sha256),
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

/** The student's current lab, which every Student portal page shows (S10, #379). */
export interface StudentLabRow {
  labId: string;
  labName: string;
  simulationId: string;
  simulationName: string;
  /** The state of its simulation; a finished one is shown read-only until the next join. */
  state: SimulationState;
  /** The version of the lab's logo, `null` without one ({@link logoVersion}). */
  logoVersion: string | null;
}

/**
 * Returns the student's current lab (S10, owner 2026-11-20 on #379): the lab of their prepared
 * or running simulation, of which there is at most one, or else the lab of their most recently
 * finished simulation; `null` when they are in no lab. The server decides; no page asks for a
 * lab by its id.
 */
export async function getCurrentStudentLab(
  db: Kysely<DB>,
  userId: string,
): Promise<StudentLabRow | null> {
  const row = await studentLabsQuery(db, userId)
    .innerJoin("simulations", "simulations.id", "labs.simulation_id")
    .leftJoin("lab_logos", "lab_logos.lab_id", "labs.id")
    .select([
      "lab_logos.sha256",
      "labs.id as lab_id",
      "labs.name as lab_name",
      "simulations.id as simulation_id",
      "simulations.name as simulation_name",
      "simulations.state",
    ])
    // NOTE: #379; an unfinished simulation first, then the latest finish, then the newest id, so
    // the same rows always give the same lab.
    .orderBy(sql`simulations.state = 'finished'`)
    .orderBy("simulations.finished_at", (ob) => ob.desc().nullsFirst())
    .orderBy("simulations.id", "desc")
    .limit(1)
    .executeTakeFirst();
  if (!row) return null;
  return {
    labId: row.lab_id,
    labName: row.lab_name,
    simulationId: row.simulation_id,
    simulationName: row.simulation_name,
    state: toSimulationState(row.state),
    logoVersion: logoVersion(row.sha256),
  };
}
