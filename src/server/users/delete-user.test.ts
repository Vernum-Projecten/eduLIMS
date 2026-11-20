// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Deleting a user from the Admin portal in one transaction (#318, B1, D10, ASVS V2.3.4). The
// races on a committed database are in src/server/simulations/teacher-concurrency.test.ts.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { Auth } from "../auth.ts";
import type { DB } from "../db/schema.gen.ts";
import { AuthError } from "../middleware.ts";
import { setSecurityLogWriter } from "../security-log.ts";
import { createLab } from "../simulations/labs.ts";
import { createSimulation } from "../simulations/simulations.ts";
import { NOW } from "../simulations/test-helpers.ts";
import { ADMIN_DISABLED_PATHS } from "./admin-path-lock.ts";
import { deleteUser, isOnlyTeacherOfASimulation, ONLY_SIMULATION_TEACHER } from "./delete-user.ts";
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

describe("better-auth's admin/remove-user (#318)", () => {
  async function adminAndVictim(auth: Auth) {
    await createUser(auth, "admin@example.test", ["admin"]);
    const victimId = await createUser(auth, "victim@example.test", ["student"]);
    const headers = await signIn(auth, "admin@example.test");
    return { victimId, headers };
  }

  it("is a disabled path", () => {
    expect(ADMIN_DISABLED_PATHS).toContain("/admin/remove-user");
  });

  it("answers 404 over HTTP, even to an administrator, and deletes nothing", async () => {
    const opened = await authOnTestDb();
    db = opened.db;
    const { victimId, headers } = await adminAndVictim(opened.auth);
    const response = await opened.auth.handler(
      new Request("http://localhost:3000/api/auth/admin/remove-user", {
        method: "POST",
        headers: { ...Object.fromEntries(headers), "content-type": "application/json" },
        body: JSON.stringify({ userId: victimId }),
      }),
    );
    expect(response.status).toBe(404);
    expect((await rowsOf(opened.db, victimId)).user).toBe(1);
  });

  it("refuses the server-side auth.api call with 404 too", async () => {
    const opened = await authOnTestDb();
    db = opened.db;
    const { victimId, headers } = await adminAndVictim(opened.auth);
    await expect(
      opened.auth.api.removeUser({ body: { userId: victimId }, headers }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect((await rowsOf(opened.db, victimId)).user).toBe(1);
  });
});
