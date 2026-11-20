// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The lock order of the administrator paths on a committed database (second review of #356): a
// teacher change of a simulation a teacher-administrator teaches beside a block (S1), and an
// administrator blocked while their own block of a third waits (S2). A third connection holds an
// administrator row, both operations queue behind it in a known order, and the hold is released.
import { afterEach, describe, expect, it } from "vitest";
import { type CommittedTestDb, createCommittedTestDb } from "../db/test-committed-db.ts";
import { inUserOrder } from "../db/test-lock-waiters.ts";
import { parseEnv } from "../env.ts";
import { AuthError } from "../middleware.ts";
import { createSimulation } from "../simulations/simulations.ts";
import { removeTeacher } from "../simulations/teachers.ts";
import { NOW } from "../simulations/test-helpers.ts";
import { createTestAuth } from "../test-auth.ts";
import { VALID_ENV } from "../test-env.ts";
import { blockUser } from "./actions.ts";
import { NOT_AN_ADMIN } from "./administrators.ts";
import { insertSignedInUser } from "./test-helpers.ts";

let committed: CommittedTestDb | undefined;

afterEach(async () => {
  await committed?.destroy();
  committed = undefined;
});

/** Returns the outcome of `run`, or the error it threw, so a forced order never rejects early. */
function settled<T>(run: () => Promise<T>): () => Promise<T | unknown> {
  return () => run().catch((error: unknown) => error);
}

async function open() {
  committed = await createCommittedTestDb(12);
  const database = committed;
  const { db } = database;
  const auth = await createTestAuth(parseEnv({ ...VALID_ENV, EDULIMS_DEV_LOGIN: "true" }), {
    db,
    type: "postgres",
  });
  const contextOf = (actorId: string) => ({
    auth,
    db,
    headers: new Headers(),
    now: NOW,
    actor: { id: actorId, roles: ["admin"] as const },
  });
  return { database, db, contextOf };
}

async function bannedOf(database: CommittedTestDb, id: string) {
  const row = await database.db
    .selectFrom("user")
    .select("banned")
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
  return row.banned;
}

describe("a teacher change beside a block (second review of #356, S1)", () => {
  it("settles both without a deadlock when a teacher-administrator teaches the simulation", async () => {
    const { database, db, contextOf } = await open();
    // No password hashing: on a busy runner it, not the race, would use up the time budget.
    const u1 = await insertSignedInUser(db, "teacher-one@example.test", ["teacher"]);
    const u2 = await insertSignedInUser(db, "teacher-admin@example.test", ["teacher", "admin"]);
    const u3 = await insertSignedInUser(db, "admin-three@example.test", ["admin"]);
    expect([u1, u2, u3].toSorted()).toEqual([u1, u2, u3]);
    const created = await createSimulation(
      db,
      { id: u1, roles: ["teacher"] },
      { name: "Lock order" },
      NOW,
    );
    if (!created.ok) throw new Error(created.error);
    const { simulationId } = created.value;
    await db
      .insertInto("simulation_teachers")
      .values({ simulation_id: simulationId, user_id: u2, added_by: u1 })
      .execute();
    const [blocked, removed] = await inUserOrder(
      database,
      u2,
      settled(() => blockUser(contextOf(u3), { userId: u1, reason: "Lock order", until: "" })),
      settled(() =>
        removeTeacher(db, { id: u1, roles: ["teacher"] }, { simulationId, userId: u2 }),
      ),
    );
    expect(blocked).toEqual({ ok: true });
    expect(removed).toEqual({ ok: true, value: null });
    expect(await bannedOf(database, u1)).toBe(true);
  });
});

describe("an administrator blocked while their own block waits (second review of #356, S2)", () => {
  it("refuses the blocked administrator's block with 403 and leaves its target unblocked", async () => {
    const { database, db, contextOf } = await open();
    const a = await insertSignedInUser(db, "admin-a@example.test", ["admin"]);
    const b = await insertSignedInUser(db, "admin-b@example.test", ["admin"]);
    const c = await insertSignedInUser(db, "admin-c@example.test", ["admin"]);
    expect([a, b, c].toSorted()).toEqual([a, b, c]);
    const [first, second] = await inUserOrder(
      database,
      a,
      settled(() => blockUser(contextOf(a), { userId: b, reason: "Forced order", until: "" })),
      settled(() => blockUser(contextOf(b), { userId: c, reason: "Forced order", until: "" })),
    );
    expect(first).toEqual({ ok: true });
    expect(second).toBeInstanceOf(AuthError);
    expect(second).toMatchObject({ status: 403 });
    expect(await bannedOf(database, b)).toBe(true);
    expect(await bannedOf(database, c)).toBeNull();
    const refused = await db
      .selectFrom("audit_event")
      .select(["action", "actor_id", "reason_code", "target_id"])
      .where("outcome", "=", "refused")
      .orderBy("id")
      .execute();
    expect(refused).toEqual([
      { action: "user_banned", actor_id: b, reason_code: NOT_AN_ADMIN, target_id: c },
    ]);
  });
});
