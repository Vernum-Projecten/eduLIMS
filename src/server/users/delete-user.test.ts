// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Deleting a user in one transaction (#318, B1, D10, ASVS V2.3.4). The races on a committed
// database are in src/server/simulations/teacher-concurrency.test.ts and delete-user-race.test.ts;
// the closed better-auth endpoints in admin-endpoint-lock.test.ts.
import { type Kysely, sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { AuthError } from "../middleware.ts";
import { setSecurityLogWriter } from "../security-log.ts";
import { createLab } from "../simulations/labs.ts";
import { createSimulation } from "../simulations/simulations.ts";
import { NOW } from "../simulations/test-helpers.ts";
import {
  deleteUser,
  isOnlyTeacherOfASimulation,
  LAST_ADMIN,
  ONLY_SIMULATION_TEACHER,
} from "./delete-user.ts";
import { authOnTestDb, createUser, signedInActor, signIn } from "./test-helpers.ts";

let db: Kysely<DB> | undefined;
let restoreLog: (() => void) | undefined;

afterEach(async () => {
  restoreLog?.();
  restoreLog = undefined;
  await db?.destroy();
  db = undefined;
});

async function setup() {
  const env = await authOnTestDb();
  db = env.db;
  const admin = await signedInActor(env.auth, env.db, "admin@example.test", ["admin"]);
  return { ...env, admin };
}

async function simulationOf(database: Kysely<DB>, teacherId: string): Promise<string> {
  const teacher = { id: teacherId, roles: ["teacher"] as const };
  const simulation = await createSimulation(database, teacher, { name: "Deletion run" }, NOW);
  if (!simulation.ok) throw new Error(simulation.error);
  const lab = await createLab(
    database,
    teacher,
    { simulationId: simulation.value.simulationId, name: "Lab Aurora" },
    NOW,
  );
  if (!lab.ok) throw new Error(lab.error);
  return simulation.value.simulationId;
}

async function addTeacherRow(database: Kysely<DB>, simulationId: string, userId: string) {
  await database
    .insertInto("simulation_teachers")
    .values({ simulation_id: simulationId, user_id: userId })
    .execute();
}

/** Counts the user row, the account rows and the session rows of `userId`. */
async function rowsOf(database: Kysely<DB>, userId: string) {
  const count = async (table: "user" | "account" | "session") => {
    const column = table === "user" ? "id" : "userId";
    const rows = await database
      .selectFrom(table)
      .select(column)
      .where(column, "=", userId)
      .execute();
    return rows.length;
  };
  return {
    user: await count("user"),
    accounts: await count("account"),
    sessions: await count("session"),
  };
}

function events(database: Kysely<DB>, action: "user_deleted" | "session_revoked") {
  return database
    .selectFrom("audit_event")
    .select(["actor_id", "target_type", "target_id", "outcome", "reason_code", "request_id"])
    .where("action", "=", action)
    .orderBy("target_id")
    .execute();
}

describe("deleteUser (#318, B1)", () => {
  it("deletes the user, their accounts and their sessions, and logs each with ids only", async () => {
    const { auth, db: database, admin } = await setup();
    const studentId = await createUser(auth, "leaving@example.test", ["student"]);
    await signIn(auth, "leaving@example.test");
    await signIn(auth, "leaving@example.test");
    const sessionIds = (
      await database.selectFrom("session").select("id").where("userId", "=", studentId).execute()
    ).map((row) => row.id);
    expect(sessionIds).toHaveLength(2);
    const lines: string[] = [];
    restoreLog = setSecurityLogWriter((line) => lines.push(line));
    const headers = new Headers(admin.headers);
    headers.set("x-request-id", "req-318");
    const result = await deleteUser({ ...admin, headers }, { userId: studentId });
    expect(result).toEqual({ ok: true });
    expect(await rowsOf(database, studentId)).toEqual({ user: 0, accounts: 0, sessions: 0 });
    expect(await events(database, "user_deleted")).toEqual([
      {
        actor_id: admin.actor.id,
        target_type: "user",
        target_id: studentId,
        outcome: "success",
        reason_code: null,
        request_id: "req-318",
      },
    ]);
    expect(await events(database, "session_revoked")).toEqual(
      sessionIds.sort().map((id) => ({
        actor_id: admin.actor.id,
        target_type: "session",
        target_id: id,
        outcome: "success",
        reason_code: "user_deleted",
        request_id: "req-318",
      })),
    );
    // The security log line: ids and codes, never the name or the address (E4).
    const deleted = lines.find((line) => line.includes('"event":"user_deleted"'));
    expect(deleted).toContain(studentId);
    for (const line of lines) {
      expect(line).not.toContain("leaving@example.test");
      expect(line).not.toContain("Test leaving");
    }
  });

  it("refuses the only teacher of a simulation and leaves user, accounts and sessions intact (D10)", async () => {
    const { auth, db: database, admin } = await setup();
    const onlyId = await createUser(auth, "only@example.test", ["teacher"]);
    await signIn(auth, "only@example.test");
    await simulationOf(database, onlyId);
    const before = await rowsOf(database, onlyId);
    expect(before).toEqual({ user: 1, accounts: 1, sessions: 1 });
    const result = await deleteUser(admin, { userId: onlyId });
    expect(result).toEqual({ ok: false, error: ONLY_SIMULATION_TEACHER });
    expect(await rowsOf(database, onlyId)).toEqual(before);
    expect(await events(database, "session_revoked")).toEqual([]);
    expect(await events(database, "user_deleted")).toEqual([
      expect.objectContaining({
        actor_id: admin.actor.id,
        target_id: onlyId,
        outcome: "refused",
        reason_code: ONLY_SIMULATION_TEACHER,
      }),
    ]);
  });

  it("refuses when the only co-teacher row belongs to a former teacher (#311 finding 1)", async () => {
    const { auth, db: database, admin } = await setup();
    const onlyId = await createUser(auth, "only@example.test", ["teacher"]);
    const formerId = await createUser(auth, "former@example.test", ["teacher"]);
    const simulationId = await simulationOf(database, onlyId);
    await addTeacherRow(database, simulationId, formerId);
    await database.updateTable("user").set({ role: "admin" }).where("id", "=", formerId).execute();
    expect(await deleteUser(admin, { userId: onlyId })).toEqual({
      ok: false,
      error: ONLY_SIMULATION_TEACHER,
    });
    expect((await rowsOf(database, onlyId)).user).toBe(1);
  });

  it("deletes a former teacher whose row is the last of a simulation (#311)", async () => {
    const { auth, db: database, admin } = await setup();
    const formerId = await createUser(auth, "former@example.test", ["teacher"]);
    await simulationOf(database, formerId);
    await database
      .updateTable("user")
      .set({ role: "student" })
      .where("id", "=", formerId)
      .execute();
    expect(await isOnlyTeacherOfASimulation(database, formerId)).toBe(false);
    expect(await deleteUser(admin, { userId: formerId })).toEqual({ ok: true });
    expect((await rowsOf(database, formerId)).user).toBe(0);
  });

  it("counts a co-teacher who holds teacher and admin (#311 finding 1)", async () => {
    const { auth, db: database, admin } = await setup();
    const firstId = await createUser(auth, "first@example.test", ["teacher"]);
    const bothId = await createUser(auth, "both@example.test", ["teacher", "admin"]);
    const simulationId = await simulationOf(database, firstId);
    await addTeacherRow(database, simulationId, bothId);
    expect(await isOnlyTeacherOfASimulation(database, firstId)).toBe(false);
    expect(await deleteUser(admin, { userId: firstId })).toEqual({ ok: true });
    expect((await rowsOf(database, firstId)).user).toBe(0);
  });

  it("deletes a teacher while another teacher stays, and keeps the simulation", async () => {
    const { auth, db: database, admin } = await setup();
    const firstId = await createUser(auth, "first@example.test", ["teacher"]);
    const secondId = await createUser(auth, "second@example.test", ["teacher"]);
    const simulationId = await simulationOf(database, firstId);
    await addTeacherRow(database, simulationId, secondId);
    expect(await deleteUser(admin, { userId: firstId })).toEqual({ ok: true });
    const teachers = await database
      .selectFrom("simulation_teachers")
      .select("user_id")
      .where("simulation_id", "=", simulationId)
      .execute();
    expect(teachers).toEqual([{ user_id: secondId }]);
    const simulation = await database
      .selectFrom("simulations")
      .select("created_by")
      .where("id", "=", simulationId)
      .executeTakeFirst();
    expect(simulation).toEqual({ created_by: null });
  });

  it("deletes a teacher who teaches no simulation", async () => {
    const { auth, db: database, admin } = await setup();
    const otherId = await createUser(auth, "other@example.test", ["teacher"]);
    expect(await deleteUser(admin, { userId: otherId })).toEqual({ ok: true });
    expect((await rowsOf(database, otherId)).user).toBe(0);
  });

  it("refuses the administrator's own account, logs it, and keeps their session", async () => {
    const { db: database, admin } = await setup();
    expect(await deleteUser(admin, { userId: admin.actor.id })).toEqual({
      ok: false,
      error: "cannot_delete_self",
    });
    expect(await rowsOf(database, admin.actor.id)).toEqual({ user: 1, accounts: 1, sessions: 1 });
    expect(await events(database, "user_deleted")).toEqual([
      expect.objectContaining({
        actor_id: admin.actor.id,
        target_id: admin.actor.id,
        outcome: "refused",
        reason_code: "cannot_delete_self",
      }),
    ]);
  });

  it("answers not_found for an unknown user and writes nothing", async () => {
    const { db: database, admin } = await setup();
    expect(await deleteUser(admin, { userId: "no-such-user" })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await events(database, "user_deleted")).toEqual([]);
  });

  it.each([
    ["a teacher", ["teacher"]],
    ["a student", ["student"]],
  ] as const)("refuses %s with 403 and deletes nothing (E1)", async (_who, roles) => {
    const { auth, db: database } = await setup();
    const victimId = await createUser(auth, "victim@example.test", ["student"]);
    const caller = await signedInActor(auth, database, "caller@example.test", roles);
    await expect(deleteUser(caller, { userId: victimId })).rejects.toThrow(AuthError);
    expect((await rowsOf(database, victimId)).user).toBe(1);
  });
});

describe("deleteUser keeps an administrator (maintainer, 2026-11-20, #318)", () => {
  it("refuses the last administrator, who keeps everything, and logs it", async () => {
    const { auth, db: database, admin } = await setup();
    const lastId = await createUser(auth, "last-admin@example.test", ["admin"]);
    await signIn(auth, "last-admin@example.test");
    // The caller was blocked after signing in, so the target is the only administrator left who
    // is not blocked (#356 review, S3).
    await database
      .updateTable("user")
      .set({ banned: true, banExpires: null })
      .where("id", "=", admin.actor.id)
      .execute();
    const before = await rowsOf(database, lastId);
    expect(before).toEqual({ user: 1, accounts: 1, sessions: 1 });
    expect(await deleteUser(admin, { userId: lastId })).toEqual({ ok: false, error: LAST_ADMIN });
    expect(await rowsOf(database, lastId)).toEqual(before);
    expect(await events(database, "session_revoked")).toEqual([]);
    expect(await events(database, "user_deleted")).toEqual([
      expect.objectContaining({ target_id: lastId, outcome: "refused", reason_code: LAST_ADMIN }),
    ]);
  });

  it("refuses a caller who lost the admin role meanwhile with 403, and logs it (#356 N3)", async () => {
    const { auth, db: database, admin } = await setup();
    const otherId = await createUser(auth, "other-admin@example.test", ["admin"]);
    await database
      .updateTable("user")
      .set({ role: "teacher" })
      .where("id", "=", admin.actor.id)
      .execute();
    const before = await rowsOf(database, otherId);
    await expect(deleteUser(admin, { userId: otherId })).rejects.toThrow(AuthError);
    expect(await rowsOf(database, otherId)).toEqual(before);
    expect(await events(database, "user_deleted")).toEqual([
      expect.objectContaining({
        actor_id: admin.actor.id,
        target_id: otherId,
        outcome: "refused",
        reason_code: "not_an_admin",
      }),
    ]);
  });

  it.each([
    ["an administrator", ["admin"]],
    ["a teacher-administrator", ["teacher", "admin"]],
  ] as const)("deletes %s while another administrator stays", async (_who, roles) => {
    const { auth, db: database, admin } = await setup();
    const otherId = await createUser(auth, "other-admin@example.test", roles);
    expect(await deleteUser(admin, { userId: otherId })).toEqual({ ok: true });
    expect(await rowsOf(database, otherId)).toEqual({ user: 0, accounts: 0, sessions: 0 });
  });
});

describe("deleteUser and the deferred last-teacher check (#318 review, N1)", () => {
  it("runs the check before the activity-log rows, so a refusal writes no success line", async () => {
    const { auth, db: database, admin } = await setup();
    const firstId = await createUser(auth, "first@example.test", ["teacher"]);
    const secondId = await createUser(auth, "second@example.test", ["teacher"]);
    await signIn(auth, "first@example.test");
    const simulationId = await simulationOf(database, firstId);
    await addTeacherRow(database, simulationId, secondId);
    // The deferred check refuses every removal for this case; the test's rollback restores it.
    await sql`create or replace function simulation_teachers_keep_one() returns trigger
      language plpgsql as $$ begin
        raise exception 'refused at the check'
          using errcode = '23514', constraint = 'simulation_teachers_last_teacher';
      end $$`.execute(database);
    const before = await rowsOf(database, firstId);
    const lines: string[] = [];
    restoreLog = setSecurityLogWriter((line) => lines.push(line));
    const result = await deleteUser(admin, { userId: firstId });
    expect(result).toEqual({ ok: false, error: ONLY_SIMULATION_TEACHER });
    expect(await rowsOf(database, firstId)).toEqual(before);
    const written = lines.map((line): unknown => JSON.parse(line));
    expect(written).toEqual([
      expect.objectContaining({
        event: "user_deleted",
        outcome: "refused",
        reason: ONLY_SIMULATION_TEACHER,
      }),
    ]);
  });
});
