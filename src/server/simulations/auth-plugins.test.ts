// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { type Kysely, sql } from "kysely";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Auth } from "../auth.ts";
import { UUID_PATTERN } from "../db/ids.ts";
import type { DB } from "../db/schema.gen.ts";
import { authOnTestDb, createUser, signIn } from "../users/test-helpers.ts";
import { isOnlyTeacherOfASimulation, ONLY_SIMULATION_TEACHER } from "./auth-plugins.ts";
import { addEmails } from "./emails.ts";
import { createLab } from "./labs.ts";
import { createSimulation } from "./simulations.ts";
import { NOW } from "./test-helpers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
  vi.restoreAllMocks();
});

async function setup(): Promise<{ auth: Auth; db: Kysely<DB> }> {
  const opened = await authOnTestDb();
  db = opened.db;
  return opened;
}

async function simulationWithLab(database: Kysely<DB>, teacherId: string) {
  const teacher = { id: teacherId, roles: ["teacher"] as const };
  const simulation = await createSimulation(database, teacher, { name: "Sign-in run" }, NOW);
  if (!simulation.ok) throw new Error(simulation.error);
  const { simulationId } = simulation.value;
  const lab = await createLab(database, teacher, { simulationId, name: "Lab Aurora" }, NOW);
  if (!lab.ok) throw new Error(lab.error);
  return { teacher, simulationId, labId: lab.value.labId };
}

async function verify(database: Kysely<DB>, userId: string) {
  await database
    .updateTable("user")
    .set({ emailVerified: true })
    .where("id", "=", userId)
    .execute();
}

describe("the better-auth set-up without the organization plugin (ADR 0021)", () => {
  it("answers 404 on the organization plugin's paths, even to a signed-in teacher", async () => {
    const { auth } = await setup();
    await createUser(auth, "teacher@example.test", ["teacher"]);
    const headers = await signIn(auth, "teacher@example.test");
    for (const path of [
      "/organization/create",
      "/organization/list",
      "/organization/create-team",
    ]) {
      const response = await auth.handler(
        new Request(`http://localhost:3000/api/auth${path}`, {
          method: "POST",
          headers: { ...Object.fromEntries(headers), "content-type": "application/json" },
          body: JSON.stringify({ name: "Side door", slug: "side-door" }),
        }),
      );
      expect([path, response.status]).toEqual([path, 404]);
    }
  });

  it("keeps no organization table and no active-organization session column", async () => {
    const { db: database } = await setup();
    const tables = await sql<{ name: string }>`
      select table_name as name from information_schema.columns
      where table_schema = current_schema()
        and (table_name in ('organization', 'member', 'invitation', 'team', 'teamMember')
          or column_name in ('activeOrganizationId', 'activeTeamId'))`.execute(database);
    expect(tables.rows).toEqual([]);
  });

  it("gives every better-auth row a UUIDv7 id", async () => {
    const { auth } = await setup();
    const id = await createUser(auth, "teacher@example.test", ["teacher"]);
    expect(id).toMatch(UUID_PATTERN);
    expect(id.charAt(14)).toBe("7");
  });
});

describe("labSignInLink (S10: in the lab at sign-in)", () => {
  it("puts a student in the lab that waits for their verified address when they sign in", async () => {
    const { auth, db: database } = await setup();
    const teacherId = await createUser(auth, "teacher@example.test", ["teacher"]);
    const studentId = await createUser(auth, "newcomer@example.test", ["student"]);
    await verify(database, studentId);
    const { teacher, simulationId, labId } = await simulationWithLab(database, teacherId);
    await addEmails(database, teacher, { labId, emails: ["newcomer@example.test"] }, NOW);
    await signIn(auth, "newcomer@example.test");
    const place = await database
      .selectFrom("lab_members")
      .select(["lab_id", "joined_via"])
      .where("simulation_id", "=", simulationId)
      .where("user_id", "=", studentId)
      .executeTakeFirst();
    expect(place).toEqual({ lab_id: labId, joined_via: "email" });
  });

  it("never fails a sign-in when the link fails", async () => {
    const { auth, db: database } = await setup();
    const teacherId = await createUser(auth, "teacher@example.test", ["teacher"]);
    const studentId = await createUser(auth, "newcomer@example.test", ["student"]);
    await verify(database, studentId);
    const { teacher, labId } = await simulationWithLab(database, teacherId);
    await addEmails(database, teacher, { labId, emails: ["newcomer@example.test"] }, NOW);
    await sql`create function test_refuse_place() returns trigger language plpgsql as $$
      begin raise exception 'refused'; end $$`.execute(database);
    await sql`create trigger test_refuse_place before insert on lab_members
      for each row execute function test_refuse_place()`.execute(database);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(signIn(auth, "newcomer@example.test")).resolves.toBeInstanceOf(Headers);
    expect(errors).toHaveBeenCalled();
    for (const call of errors.mock.calls) expect(String(call[0])).not.toContain("@");
  });
});

describe("simulationTeacherGuard (D10: never the last teacher)", () => {
  it("refuses to delete the only teacher of a simulation, and logs it", async () => {
    const { auth, db: database } = await setup();
    await createUser(auth, "admin@example.test", ["admin"]);
    const onlyId = await createUser(auth, "only@example.test", ["teacher"]);
    await simulationWithLab(database, onlyId);
    const headers = await signIn(auth, "admin@example.test");
    await expect(auth.api.removeUser({ body: { userId: onlyId }, headers })).rejects.toThrow(
      ONLY_SIMULATION_TEACHER,
    );
    const still = await database.selectFrom("user").select("id").where("id", "=", onlyId).execute();
    expect(still).toHaveLength(1);
    const refused = await database
      .selectFrom("audit_event")
      .select(["outcome", "reason_code", "target_id"])
      .where("action", "=", "user_deleted")
      .execute();
    expect(refused).toEqual([
      { outcome: "refused", reason_code: ONLY_SIMULATION_TEACHER, target_id: onlyId },
    ]);
  });

  it("refuses when the only co-teacher row belongs to a former teacher (#311 finding 1)", async () => {
    const { auth, db: database } = await setup();
    await createUser(auth, "admin@example.test", ["admin"]);
    const onlyId = await createUser(auth, "only@example.test", ["teacher"]);
    const formerId = await createUser(auth, "former@example.test", ["teacher"]);
    const { simulationId } = await simulationWithLab(database, onlyId);
    await database
      .insertInto("simulation_teachers")
      .values({ simulation_id: simulationId, user_id: formerId, added_by: onlyId })
      .execute();
    await database.updateTable("user").set({ role: "admin" }).where("id", "=", formerId).execute();
    const headers = await signIn(auth, "admin@example.test");
    await expect(auth.api.removeUser({ body: { userId: onlyId }, headers })).rejects.toThrow(
      ONLY_SIMULATION_TEACHER,
    );
    const still = await database.selectFrom("user").select("id").where("id", "=", onlyId).execute();
    expect(still).toHaveLength(1);
  });

  it("deletes a former teacher whose row is the last of a simulation (#311)", async () => {
    const { auth, db: database } = await setup();
    await createUser(auth, "admin@example.test", ["admin"]);
    const formerId = await createUser(auth, "former@example.test", ["teacher"]);
    await simulationWithLab(database, formerId);
    await database
      .updateTable("user")
      .set({ role: "student" })
      .where("id", "=", formerId)
      .execute();
    expect(await isOnlyTeacherOfASimulation(database, formerId)).toBe(false);
    const headers = await signIn(auth, "admin@example.test");
    await auth.api.removeUser({ body: { userId: formerId }, headers });
    const gone = await database
      .selectFrom("user")
      .select("id")
      .where("id", "=", formerId)
      .execute();
    expect(gone).toEqual([]);
  });

  it("counts a co-teacher who holds teacher and admin (#311 finding 1)", async () => {
    const { auth, db: database } = await setup();
    await createUser(auth, "admin@example.test", ["admin"]);
    const firstId = await createUser(auth, "first@example.test", ["teacher"]);
    const bothId = await createUser(auth, "both@example.test", ["teacher", "admin"]);
    const { simulationId } = await simulationWithLab(database, firstId);
    await database
      .insertInto("simulation_teachers")
      .values({ simulation_id: simulationId, user_id: bothId, added_by: firstId })
      .execute();
    expect(await isOnlyTeacherOfASimulation(database, firstId)).toBe(false);
    const headers = await signIn(auth, "admin@example.test");
    await auth.api.removeUser({ body: { userId: firstId }, headers });
    const gone = await database.selectFrom("user").select("id").where("id", "=", firstId).execute();
    expect(gone).toEqual([]);
  });

  it("deletes a teacher once another teacher teaches the simulation too", async () => {
    const { auth, db: database } = await setup();
    await createUser(auth, "admin@example.test", ["admin"]);
    const firstId = await createUser(auth, "first@example.test", ["teacher"]);
    const secondId = await createUser(auth, "second@example.test", ["teacher"]);
    const { simulationId } = await simulationWithLab(database, firstId);
    await database
      .insertInto("simulation_teachers")
      .values({ simulation_id: simulationId, user_id: secondId, added_by: firstId })
      .execute();
    const headers = await signIn(auth, "admin@example.test");
    await auth.api.removeUser({ body: { userId: firstId }, headers });
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

  it("deletes an account that teaches no simulation", async () => {
    const { auth, db: database } = await setup();
    await createUser(auth, "admin@example.test", ["admin"]);
    const otherId = await createUser(auth, "other@example.test", ["teacher"]);
    const headers = await signIn(auth, "admin@example.test");
    await auth.api.removeUser({ body: { userId: otherId }, headers });
    const gone = await database.selectFrom("user").select("id").where("id", "=", otherId).execute();
    expect(gone).toEqual([]);
  });
});
