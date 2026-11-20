// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The last teacher of a simulation on a committed database (D10, #300 review S2): the deferred
// constraint trigger of migration 0012 refuses a commit that leaves a simulation without a
// teacher row. An account deletion locks the simulations first and runs in one transaction
// (#318), so a deletion and `removeTeacher`, or two deletions, never both win and the loser
// changes nothing. The race rounds insert their users without hashing a password: on a busy
// runner the hashing, not the race, took the 5 seconds.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { type CommittedTestDb, createCommittedTestDb } from "../db/test-committed-db.ts";
import { parseEnv } from "../env.ts";
import { createTestAuth } from "../test-auth.ts";
import { VALID_ENV } from "../test-env.ts";
import { deleteUser, ONLY_SIMULATION_TEACHER } from "../users/delete-user.ts";
import { insertSignedInUser } from "../users/test-helpers.ts";
import { createSimulation } from "./simulations.ts";
import { isLastTeacherViolation, LAST_TEACHER_CONSTRAINT, removeTeacher } from "./teachers.ts";
import { NOW, person } from "./test-helpers.ts";

let committed: CommittedTestDb | undefined;

afterEach(async () => {
  await committed?.destroy();
  committed = undefined;
});

async function open() {
  committed = await createCommittedTestDb(12);
  return committed.db;
}

describe("the last-teacher trigger (D10, S2)", () => {
  it("refuses a commit that removes the only teacher row of a simulation", async () => {
    const db = await open();
    const teacher = await person(db, "only", ["teacher"]);
    const created = await createSimulation(db, teacher, { name: "Trigger run" }, NOW);
    if (!created.ok) throw new Error(created.error);
    const error = await db
      .deleteFrom("simulation_teachers")
      .where("simulation_id", "=", created.value.simulationId)
      .execute()
      .then(
        () => null,
        (thrown: unknown) => thrown,
      );
    expect(isLastTeacherViolation(error)).toBe(true);
    expect(error).toMatchObject({ constraint: LAST_TEACHER_CONSTRAINT });
    const rows = await db
      .selectFrom("simulation_teachers")
      .select("user_id")
      .where("simulation_id", "=", created.value.simulationId)
      .execute();
    expect(rows).toEqual([{ user_id: teacher.id }]);
  });

  it("lets a former teacher's account go even when its row is the last one (#311)", async () => {
    const db = await open();
    const former = await person(db, "former", ["teacher"]);
    const created = await createSimulation(db, former, { name: "Trigger run" }, NOW);
    if (!created.ok) throw new Error(created.error);
    await db.updateTable("user").set({ role: "admin" }).where("id", "=", former.id).execute();
    await db.deleteFrom("user").where("id", "=", former.id).execute();
    const rows = await db
      .selectFrom("simulation_teachers")
      .select("user_id")
      .where("simulation_id", "=", created.value.simulationId)
      .execute();
    expect(rows).toEqual([]);
  });

  it("lets the last teacher row of a former teacher go at commit (#311)", async () => {
    const db = await open();
    const former = await person(db, "former", ["teacher"]);
    const created = await createSimulation(db, former, { name: "Trigger run" }, NOW);
    if (!created.ok) throw new Error(created.error);
    await db.updateTable("user").set({ role: "student" }).where("id", "=", former.id).execute();
    await db
      .deleteFrom("simulation_teachers")
      .where("simulation_id", "=", created.value.simulationId)
      .execute();
    const rows = await db.selectFrom("simulation_teachers").select("user_id").execute();
    expect(rows).toEqual([]);
  });

  it("refuses the deletion of an active teacher whose co-teacher row is a former teacher's (#311)", async () => {
    const db = await open();
    const teacher = await person(db, "only", ["teacher"]);
    const former = await person(db, "former", ["teacher"]);
    const created = await createSimulation(db, teacher, { name: "Trigger run" }, NOW);
    if (!created.ok) throw new Error(created.error);
    const { simulationId } = created.value;
    await db
      .insertInto("simulation_teachers")
      .values({ simulation_id: simulationId, user_id: former.id, added_by: teacher.id })
      .execute();
    await db.updateTable("user").set({ role: "student" }).where("id", "=", former.id).execute();
    const error = await db
      .deleteFrom("user")
      .where("id", "=", teacher.id)
      .execute()
      .then(
        () => null,
        (thrown: unknown) => thrown,
      );
    expect(isLastTeacherViolation(error)).toBe(true);
    const rows = await db
      .selectFrom("simulation_teachers")
      .select("user_id")
      .where("simulation_id", "=", simulationId)
      .orderBy("user_id")
      .execute();
    expect(rows.map((row) => row.user_id).sort()).toEqual([teacher.id, former.id].sort());
  });

  it("lets a teacher row go while another teacher with the role stays (#311)", async () => {
    const db = await open();
    const teacher = await person(db, "first", ["teacher"]);
    const both = await person(db, "both", ["teacher", "admin"]);
    const created = await createSimulation(db, teacher, { name: "Trigger run" }, NOW);
    if (!created.ok) throw new Error(created.error);
    const { simulationId } = created.value;
    await db
      .insertInto("simulation_teachers")
      .values({ simulation_id: simulationId, user_id: both.id, added_by: teacher.id })
      .execute();
    await db.deleteFrom("user").where("id", "=", teacher.id).execute();
    const rows = await db
      .selectFrom("simulation_teachers")
      .select("user_id")
      .where("simulation_id", "=", simulationId)
      .execute();
    expect(rows).toEqual([{ user_id: both.id }]);
  });

  it("lets a simulation go with all its teacher rows", async () => {
    const db = await open();
    const teacher = await person(db, "only", ["teacher"]);
    const created = await createSimulation(db, teacher, { name: "Trigger run" }, NOW);
    if (!created.ok) throw new Error(created.error);
    await db.deleteFrom("simulations").where("id", "=", created.value.simulationId).execute();
    expect(await db.selectFrom("simulation_teachers").select("user_id").execute()).toEqual([]);
  });
});

/** Two teachers of one fresh simulation, each with an account and a live session. */
async function twoTeachers(db: Kysely<DB>, round: number) {
  const firstId = await insertSignedInUser(db, `first-${round}@example.test`, ["teacher"]);
  const secondId = await insertSignedInUser(db, `second-${round}@example.test`, ["teacher"]);
  const first = { id: firstId, roles: ["teacher"] as const };
  const created = await createSimulation(db, first, { name: `Race ${round}` }, NOW);
  if (!created.ok) throw new Error(created.error);
  const { simulationId } = created.value;
  await db
    .insertInto("simulation_teachers")
    .values({ simulation_id: simulationId, user_id: secondId, added_by: firstId })
    .execute();
  return { firstId, secondId, simulationId };
}

/** The user, account and session rows of `userId`. */
async function rowsOf(db: Kysely<DB>, userId: string) {
  const [user, accounts, sessions] = await Promise.all([
    db.selectFrom("user").select("id").where("id", "=", userId).execute(),
    db.selectFrom("account").select("id").where("userId", "=", userId).execute(),
    db.selectFrom("session").select("id").where("userId", "=", userId).execute(),
  ]);
  return { user: user.length, accounts: accounts.length, sessions: sessions.length };
}

async function teachersOf(db: Kysely<DB>, simulationId: string): Promise<string[]> {
  const rows = await db
    .selectFrom("simulation_teachers")
    .select("user_id")
    .where("simulation_id", "=", simulationId)
    .execute();
  return rows.map((row) => row.user_id);
}

describe("deleting a user against the last-teacher rule, on a committed database (#318, D10)", () => {
  async function openWithAdmin() {
    const db = await open();
    const auth = await createTestAuth(parseEnv({ ...VALID_ENV, EDULIMS_DEV_LOGIN: "true" }), {
      db,
      type: "postgres",
    });
    const adminId = await insertSignedInUser(db, "admin@example.test", ["admin"]);
    const admin = {
      auth,
      db,
      headers: new Headers(),
      now: NOW,
      actor: { id: adminId, roles: ["admin"] as const },
    };
    return { db, admin };
  }

  it("a deletion racing removeTeacher ends with one active teacher and the loser unchanged", async () => {
    const { db, admin } = await openWithAdmin();
    for (const round of [1, 2, 3, 4, 5]) {
      const { firstId, secondId, simulationId } = await twoTeachers(db, round);
      const second = { id: secondId, roles: ["teacher"] as const };
      const firstBefore = await rowsOf(db, firstId);
      const [deletion, removal] = await Promise.all([
        deleteUser(admin, { userId: firstId }),
        removeTeacher(db, second, { simulationId, userId: secondId }),
      ]);
      const teachers = await teachersOf(db, simulationId);
      if (deletion.ok) {
        // The removal lost: it changed nothing, and the second teacher stays.
        expect([round, removal]).toEqual([round, { ok: false, error: "last_teacher" }]);
        expect([round, teachers]).toEqual([round, [secondId]]);
        expect(await rowsOf(db, firstId)).toEqual({ user: 0, accounts: 0, sessions: 0 });
      } else {
        // The deletion lost: the user, the accounts and the sessions are as they were.
        expect([round, deletion]).toEqual([round, { ok: false, error: ONLY_SIMULATION_TEACHER }]);
        expect([round, removal]).toEqual([round, { ok: true, value: null }]);
        expect([round, teachers]).toEqual([round, [firstId]]);
        expect(await rowsOf(db, firstId)).toEqual(firstBefore);
      }
    }
  });

  it("two deletions of the two active teachers of one simulation end with one teacher left", async () => {
    const { db, admin } = await openWithAdmin();
    for (const round of [1, 2, 3, 4, 5]) {
      const { firstId, secondId, simulationId } = await twoTeachers(db, round);
      const before = {
        [firstId]: await rowsOf(db, firstId),
        [secondId]: await rowsOf(db, secondId),
      };
      const results = await Promise.all([
        deleteUser(admin, { userId: firstId }),
        deleteUser(admin, { userId: secondId }),
      ]);
      const won = results.filter((result) => result.ok);
      expect([round, won.length]).toEqual([round, 1]);
      const loserId = results[0]?.ok ? secondId : firstId;
      const winnerId = loserId === firstId ? secondId : firstId;
      expect([round, results.find((result) => !result.ok)]).toEqual([
        round,
        { ok: false, error: ONLY_SIMULATION_TEACHER },
      ]);
      expect([round, await teachersOf(db, simulationId)]).toEqual([round, [loserId]]);
      expect(await rowsOf(db, loserId)).toEqual(before[loserId]);
      expect(await rowsOf(db, winnerId)).toEqual({ user: 0, accounts: 0, sessions: 0 });
    }
  });
});
