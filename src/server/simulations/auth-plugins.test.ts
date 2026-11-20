// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { type Kysely, sql } from "kysely";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Auth } from "../auth.ts";
import { UUID_PATTERN } from "../db/ids.ts";
import type { DB } from "../db/schema.gen.ts";
import { authOnTestDb, createUser, signIn } from "../users/test-helpers.ts";
import { addEmails } from "./emails.ts";
import { createLab } from "./labs.ts";
import { removeMember } from "./members.ts";
import { createSimulation } from "./simulations.ts";
import { NOW, place } from "./test-helpers.ts";

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

  it("refuses a removed student at sign-in and logs it once per removal (#330)", async () => {
    const { auth, db: database } = await setup();
    const teacherId = await createUser(auth, "teacher@example.test", ["teacher"]);
    const studentId = await createUser(auth, "late-verified@example.test", ["student"]);
    const { teacher, simulationId, labId } = await simulationWithLab(database, teacherId);
    const other = await createLab(database, teacher, { simulationId, name: "Lab Borealis" }, NOW);
    if (!other.ok) throw new Error(other.error);
    await addEmails(
      database,
      teacher,
      { labId: other.value.labId, emails: ["late-verified@example.test"] },
      NOW,
    );
    await place(database, simulationId, labId, studentId);
    const removed = await removeMember(database, teacher, { simulationId, userId: studentId }, NOW);
    expect(removed).toEqual({ ok: true, value: null });
    await verify(database, studentId);
    await signIn(auth, "late-verified@example.test");
    await signIn(auth, "late-verified@example.test");
    const places = await database
      .selectFrom("lab_members")
      .select("lab_id")
      .where("user_id", "=", studentId)
      .execute();
    expect(places).toEqual([]);
    const refusals = await database
      .selectFrom("audit_event")
      .select(["actor_id", "reason_code", "target_id"])
      .where("action", "=", "lab_member_joined")
      .where("outcome", "=", "refused")
      .execute();
    expect(refusals).toEqual([
      { actor_id: studentId, reason_code: "removed", target_id: other.value.labId },
    ]);
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
