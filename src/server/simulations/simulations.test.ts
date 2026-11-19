// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { parseSimulationId } from "../../lib/simulations.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { AuthError } from "../middleware.ts";
import { createSimulation, deleteSimulation, renameSimulation } from "./simulations.ts";
import { teacherWriteRefusals } from "./test-access.ts";
import { auditRows, NOW, person, world } from "./test-helpers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function open(): Promise<Kysely<DB>> {
  db = await createTestDb();
  return db;
}

describe("createSimulation (D10)", () => {
  it("creates a simulation with the teacher as its first teacher, logged with ids", async () => {
    const database = await open();
    const teacher = await person(database, "t", ["teacher"]);
    const result = await createSimulation(database, teacher, { name: " Spring run " }, NOW);
    if (!result.ok) throw new Error(result.error);
    const { simulationId } = result.value;
    expect(parseSimulationId(simulationId)).toBe(simulationId);
    expect(simulationId.charAt(14)).toBe("7");
    const row = await database
      .selectFrom("simulations")
      .select(["name", "created_by"])
      .where("id", "=", simulationId)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ name: "Spring run", created_by: teacher.id });
    const teachers = await database
      .selectFrom("simulation_teachers")
      .select("user_id")
      .where("simulation_id", "=", simulationId)
      .execute();
    expect(teachers).toEqual([{ user_id: teacher.id }]);
    expect(await auditRows(database, "simulation_created")).toEqual([
      {
        actor_id: teacher.id,
        outcome: "success",
        target_type: "simulation",
        target_id: simulationId,
        reason_code: null,
        metadata: null,
      },
    ]);
  });

  it.each([
    ["a student", ["student"]],
    ["an administrator", ["admin"]],
  ] as const)("refuses %s with 403 and creates nothing (R-01)", async (_who, roles) => {
    const database = await open();
    const actor = await person(database, "actor", roles);
    await expect(createSimulation(database, actor, { name: "Side door" }, NOW)).rejects.toThrow(
      AuthError,
    );
    expect(await database.selectFrom("simulations").select("id").execute()).toEqual([]);
  });

  it("lets a teacher-administrator create one as a teacher", async () => {
    const database = await open();
    const actor = await person(database, "both", ["teacher", "admin"]);
    const result = await createSimulation(database, actor, { name: "Both roles" }, NOW);
    expect(result.ok).toBe(true);
  });

  it("refuses an empty or padded name in the database too (CHECK)", async () => {
    const database = await open();
    await expect(
      database.insertInto("simulations").values({ name: " padded " }).execute(),
    ).rejects.toThrow(/simulations_name/);
  });
});

describe("renameSimulation (D10)", () => {
  it("renames it for any teacher of the simulation, logged", async () => {
    const database = await open();
    const w = await world(database);
    const result = await renameSimulation(database, w.coTeacher, {
      simulationId: w.simulationId,
      name: "Renamed",
    });
    expect(result).toEqual({ ok: true, value: null });
    const row = await database
      .selectFrom("simulations")
      .select("name")
      .where("id", "=", w.simulationId)
      .executeTakeFirstOrThrow();
    expect(row.name).toBe("Renamed");
    expect(await auditRows(database, "simulation_renamed")).toEqual([
      expect.objectContaining({
        actor_id: w.coTeacher.id,
        outcome: "success",
        target_id: w.simulationId,
      }),
    ]);
  });

  teacherWriteRefusals({
    call: (database, _w, actor, target) =>
      renameSimulation(database, actor, { simulationId: target, name: "Taken over" }),
    target: (w) => ({ type: "simulation", id: w.simulationId }),
  });
});

describe("deleteSimulation (D10, #280)", () => {
  it("refuses a simulation with a student in a lab, logged as refused", async () => {
    const database = await open();
    const w = await world(database);
    const result = await deleteSimulation(database, w.teacher, { simulationId: w.simulationId });
    expect(result).toEqual({ ok: false, error: "has_students" });
    expect(await auditRows(database, "simulation_deleted")).toEqual([
      expect.objectContaining({
        actor_id: w.teacher.id,
        outcome: "refused",
        reason_code: "has_students",
        target_id: w.simulationId,
      }),
    ]);
  });

  it("deletes a simulation without students, with its labs and waiting addresses", async () => {
    const database = await open();
    const w = await world(database);
    await database.deleteFrom("lab_members").where("simulation_id", "=", w.simulationId).execute();
    await database
      .insertInto("lab_member_emails")
      .values({ simulation_id: w.simulationId, lab_id: w.labId, email: "waits@example.test" })
      .execute();
    const result = await deleteSimulation(database, w.teacher, { simulationId: w.simulationId });
    expect(result).toEqual({ ok: true, value: null });
    const left = await Promise.all([
      database
        .selectFrom("labs")
        .select("id")
        .where("simulation_id", "=", w.simulationId)
        .execute(),
      database
        .selectFrom("lab_member_emails")
        .select("email")
        .where("simulation_id", "=", w.simulationId)
        .execute(),
      database
        .selectFrom("simulation_teachers")
        .select("user_id")
        .where("simulation_id", "=", w.simulationId)
        .execute(),
    ]);
    expect(left).toEqual([[], [], []]);
    expect(await auditRows(database, "simulation_deleted")).toEqual([
      expect.objectContaining({ outcome: "success", target_id: w.simulationId }),
    ]);
  });

  teacherWriteRefusals({
    call: (database, _w, actor, target) =>
      deleteSimulation(database, actor, { simulationId: target }),
    target: (w) => ({ type: "simulation", id: w.simulationId }),
  });
});
