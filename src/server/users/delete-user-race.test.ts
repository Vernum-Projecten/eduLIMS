// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// A user deletion and `removeTeacher` in a forced order, on a committed database (#318, D10). A
// third connection holds the simulation row, both operations queue behind it in a known order,
// and the hold is released: each order is covered on every run, which the parallel races in
// src/server/simulations/teacher-concurrency.test.ts cannot promise.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { type CommittedTestDb, createCommittedTestDb } from "../db/test-committed-db.ts";
import { parseEnv } from "../env.ts";
import type { SimulationResult } from "../simulations/access.ts";
import { createSimulation } from "../simulations/simulations.ts";
import { removeTeacher } from "../simulations/teachers.ts";
import { NOW } from "../simulations/test-helpers.ts";
import { createTestAuth } from "../test-auth.ts";
import { VALID_ENV } from "../test-env.ts";
import { type DeleteUserResult, deleteUser, ONLY_SIMULATION_TEACHER } from "./delete-user.ts";
import { createUser, signIn } from "./test-helpers.ts";

let committed: CommittedTestDb | undefined;

afterEach(async () => {
  await committed?.destroy();
  committed = undefined;
});

const WAIT_LIMIT_MS = 10_000;

/** Waits until `count` backends of this database wait on a lock. */
async function lockWaiters(database: CommittedTestDb, count: number): Promise<void> {
  const deadline = Date.now() + WAIT_LIMIT_MS;
  for (;;) {
    const { rows } = await database.pool.query<{ n: number }>(
      `select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'`,
    );
    if ((rows[0]?.n ?? 0) >= count) return;
    if (Date.now() > deadline) throw new Error(`fewer than ${count} lock waiters`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function rowsOf(db: Kysely<DB>, userId: string) {
  const [user, accounts, sessions] = await Promise.all([
    db.selectFrom("user").select("id").where("id", "=", userId).execute(),
    db.selectFrom("account").select("id").where("userId", "=", userId).execute(),
    db.selectFrom("session").select("id").where("userId", "=", userId).execute(),
  ]);
  return { user: user.length, accounts: accounts.length, sessions: sessions.length };
}

/** Two teachers of one simulation, the first signed in, and an administrator's context. */
async function world() {
  committed = await createCommittedTestDb(12);
  const database = committed;
  const { db } = database;
  const auth = await createTestAuth(parseEnv({ ...VALID_ENV, EDULIMS_DEV_LOGIN: "true" }), {
    db,
    type: "postgres",
  });
  const adminId = await createUser(auth, "admin@example.test", ["admin"]);
  const headers = await signIn(auth, "admin@example.test");
  const firstId = await createUser(auth, "first@example.test", ["teacher"]);
  const secondId = await createUser(auth, "second@example.test", ["teacher"]);
  await signIn(auth, "first@example.test");
  const created = await createSimulation(
    db,
    { id: firstId, roles: ["teacher"] },
    { name: "Forced order" },
    NOW,
  );
  if (!created.ok) throw new Error(created.error);
  const { simulationId } = created.value;
  await db
    .insertInto("simulation_teachers")
    .values({ simulation_id: simulationId, user_id: secondId, added_by: firstId })
    .execute();
  const admin = { auth, db, headers, now: NOW, actor: { id: adminId, roles: ["admin"] as const } };
  const deletion = () => deleteUser(admin, { userId: firstId });
  const removal = () =>
    removeTeacher(db, { id: secondId, roles: ["teacher"] }, { simulationId, userId: secondId });
  return { database, db, firstId, secondId, simulationId, deletion, removal };
}

/**
 * Holds the simulation row, starts `first` and waits until it waits on the row, then the same for
 * `second`, and releases the row; returns both outcomes.
 */
async function inOrder<A, B>(
  database: CommittedTestDb,
  simulationId: string,
  first: () => Promise<A>,
  second: () => Promise<B>,
): Promise<[A, B]> {
  const holder = await database.pool.connect();
  try {
    await holder.query("begin");
    await holder.query("select id from simulations where id = $1 for update", [simulationId]);
    const one = first();
    await lockWaiters(database, 1);
    const two = second();
    await lockWaiters(database, 2);
    await holder.query("commit");
    return await Promise.all([one, two]);
  } finally {
    holder.release();
  }
}

async function auditOf(db: Kysely<DB>) {
  return db
    .selectFrom("audit_event")
    .select(["action", "outcome", "reason_code", "target_id"])
    .where("action", "in", ["user_deleted", "session_revoked"])
    .orderBy("occurred_at")
    .orderBy("id")
    .execute();
}

describe("a user deletion and removeTeacher in a forced order (#318 review, S2)", () => {
  it("deletion first: the deletion wins and the removal is refused with last_teacher", async () => {
    const { database, db, firstId, secondId, simulationId, deletion, removal } = await world();
    const [deleted, removed] = await inOrder<DeleteUserResult, SimulationResult>(
      database,
      simulationId,
      deletion,
      removal,
    );
    expect(deleted).toEqual({ ok: true });
    expect(removed).toEqual({ ok: false, error: "last_teacher" });
    const teachers = await db
      .selectFrom("simulation_teachers")
      .select("user_id")
      .where("simulation_id", "=", simulationId)
      .execute();
    expect(teachers).toEqual([{ user_id: secondId }]);
    expect(await rowsOf(db, firstId)).toEqual({ user: 0, accounts: 0, sessions: 0 });
  });

  it("removal first: the deletion is refused and the user keeps everything", async () => {
    const { database, db, firstId, simulationId, deletion, removal } = await world();
    const before = await rowsOf(db, firstId);
    expect(before).toEqual({ user: 1, accounts: 1, sessions: 1 });
    const [removed, deleted] = await inOrder<SimulationResult, DeleteUserResult>(
      database,
      simulationId,
      removal,
      deletion,
    );
    expect(removed).toEqual({ ok: true, value: null });
    expect(deleted).toEqual({ ok: false, error: ONLY_SIMULATION_TEACHER });
    const teachers = await db
      .selectFrom("simulation_teachers")
      .select("user_id")
      .where("simulation_id", "=", simulationId)
      .execute();
    expect(teachers).toEqual([{ user_id: firstId }]);
    expect(await rowsOf(db, firstId)).toEqual(before);
    expect(await auditOf(db)).toEqual([
      {
        action: "user_deleted",
        outcome: "refused",
        reason_code: ONLY_SIMULATION_TEACHER,
        target_id: firstId,
      },
    ]);
  });
});
