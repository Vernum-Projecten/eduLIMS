// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The simulations the administrator's list journeys read (B5, #291), written straight into this
// run's database: twelve taught by the seeded teacher, one of them with a lab of two invented
// students, and one whose only teacher lost the app role teacher, which no screen can make.
import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { DB } from "../../src/server/db/schema.gen.ts";

/** What {@link seedAdminSimulations} stored, by the names the journeys search for. */
export interface SeededSimulations {
  /** The prefix of the twelve paged simulations; number 12 is the newest. */
  paged: string;
  /** The paged simulation with the lab. */
  withLab: string;
  lab: string;
  /** The simulation whose only teacher holds no teacher role. */
  orphan: string;
  formerTeacher: string;
}

function database(): Kysely<DB> {
  const url = process.env["EDULIMS_E2E_DATABASE_URL"];
  if (!url) throw new Error("EDULIMS_E2E_DATABASE_URL is not set; playwright.config.ts sets it.");
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 1 }) }),
  });
}

async function addUser(db: Kysely<DB>, name: string, role: string): Promise<string> {
  const id = randomUUID();
  await db
    .insertInto("user")
    .values({ id, name, email: `${id}@example.test`, emailVerified: true, role })
    .execute();
  return id;
}

async function addSimulation(
  db: Kysely<DB>,
  name: string,
  teacherId: string,
  createdAt: Date,
): Promise<string> {
  const { id } = await db
    .insertInto("simulations")
    .values({ name, created_by: teacherId, created_at: createdAt })
    .returning("id")
    .executeTakeFirstOrThrow();
  await db
    .insertInto("simulation_teachers")
    .values({ simulation_id: id, user_id: teacherId })
    .execute();
  return id;
}

/** Stores the journeys' simulations under the run-unique `suffix`. */
export async function seedAdminSimulations(suffix: string): Promise<SeededSimulations> {
  const db = database();
  try {
    const teacher = await db
      .selectFrom("user")
      .select("id")
      .where("email", "=", "teacher@example.test")
      .executeTakeFirstOrThrow();
    const paged = `Paging ${suffix}`;
    const ids: string[] = [];
    for (let n = 1; n <= 12; n += 1) {
      const name = `${paged} ${String(n).padStart(2, "0")}`;
      ids.push(await addSimulation(db, name, teacher.id, new Date(Date.UTC(2026, 0, n))));
    }
    const withLabId = ids[11];
    if (withLabId === undefined) throw new Error("no paged simulation");
    const lab = `Lab ${suffix}`;
    const { id: labId } = await db
      .insertInto("labs")
      .values({ simulation_id: withLabId, name: lab })
      .returning("id")
      .executeTakeFirstOrThrow();
    for (const n of [1, 2]) {
      const student = await addUser(db, `E2E member ${n} ${suffix}`, "student");
      await db
        .insertInto("lab_members")
        .values({ simulation_id: withLabId, lab_id: labId, user_id: student, joined_via: "email" })
        .execute();
    }
    const formerTeacher = `E2E former teacher ${suffix}`;
    const former = await addUser(db, formerTeacher, "admin");
    const orphan = `Orphan ${suffix}`;
    await addSimulation(db, orphan, former, new Date(Date.UTC(2026, 1, 1)));
    return { paged, withLab: `${paged} 12`, lab, orphan, formerTeacher };
  } finally {
    await db.destroy();
  }
}
