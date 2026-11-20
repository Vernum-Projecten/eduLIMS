// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// A teacher's move and an administrator's deletion of the same student in a forced order, on a
// committed database (security review of #392, S1). Both take the student's place before the
// student's user row, so they queue on the place and never deadlock (40P01). A third connection
// holds the place, both operations queue behind it in a known order, and the hold is released.
import { afterEach, describe, expect, it } from "vitest";
import { type CommittedTestDb, createCommittedTestDb } from "../db/test-committed-db.ts";
import { lockWaiters } from "../db/test-lock-waiters.ts";
import { parseEnv } from "../env.ts";
import type { SimulationResult } from "../simulations/access.ts";
import { moveMember } from "../simulations/members.ts";
import { NOW, world } from "../simulations/test-helpers.ts";
import { createTestAuth } from "../test-auth.ts";
import { VALID_ENV } from "../test-env.ts";
import { type DeleteUserResult, deleteUser } from "./delete-user.ts";

let committed: CommittedTestDb | undefined;

afterEach(async () => {
  await committed?.destroy();
  committed = undefined;
});

async function setUp() {
  committed = await createCommittedTestDb(10);
  const database = committed;
  const { db } = database;
  const auth = await createTestAuth(parseEnv({ ...VALID_ENV, EDULIMS_DEV_LOGIN: "true" }), {
    db,
    type: "postgres",
  });
  const w = await world(db);
  const admin = { auth, db, headers: new Headers(), now: NOW, actor: w.admin };
  const move = () =>
    moveMember(db, w.teacher, {
      simulationId: w.simulationId,
      userId: w.student.id,
      labId: w.otherLabId,
    });
  const deletion = () => deleteUser(admin, { userId: w.student.id });
  return { database, db, w, move, deletion };
}

/**
 * Holds the student's place, starts `first` and waits until it queues, then the same for
 * `second`, and releases the place; returns both outcomes.
 */
async function behindThePlace<A, B>(
  database: CommittedTestDb,
  place: { simulationId: string; userId: string },
  first: () => Promise<A>,
  second: () => Promise<B>,
): Promise<[A, B]> {
  const holder = await database.pool.connect();
  try {
    await holder.query("begin");
    await holder.query(
      "select lab_id from lab_members where simulation_id = $1 and user_id = $2 for update",
      [place.simulationId, place.userId],
    );
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

describe("a move and a deletion of one student (security review of #392, S1)", () => {
  it("move first: the move lands, then the deletion removes the student", async () => {
    const { database, db, w, move, deletion } = await setUp();
    const [moved, deleted] = await behindThePlace<SimulationResult, DeleteUserResult>(
      database,
      { simulationId: w.simulationId, userId: w.student.id },
      move,
      deletion,
    );
    expect(moved).toEqual({ ok: true, value: null });
    expect(deleted).toEqual({ ok: true });
    const left = await db.selectFrom("user").select("id").where("id", "=", w.student.id).execute();
    expect(left).toEqual([]);
  });

  it("deletion first: the student goes, and the move finds no place", async () => {
    const { database, db, w, move, deletion } = await setUp();
    const [deleted, moved] = await behindThePlace<DeleteUserResult, SimulationResult>(
      database,
      { simulationId: w.simulationId, userId: w.student.id },
      deletion,
      move,
    );
    expect(deleted).toEqual({ ok: true });
    expect(moved).toEqual({ ok: false, error: "member_not_found" });
    const moves = await db
      .selectFrom("audit_event")
      .select("outcome")
      .where("action", "=", "lab_member_moved")
      .execute();
    expect(moves).toEqual([]);
  });
});
