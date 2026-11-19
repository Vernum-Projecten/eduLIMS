// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { parseLabId } from "../../lib/simulations.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { createLab, deleteLab, renameLab } from "./labs.ts";
import { teacherWriteRefusals } from "./test-access.ts";
import { auditRows, NOW, type World, world } from "./test-helpers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function open(): Promise<{ database: Kysely<DB>; w: World }> {
  db = await createTestDb();
  return { database: db, w: await world(db) };
}

describe("createLab (D10)", () => {
  it("creates a lab in the simulation, logged with its simulation", async () => {
    const { database, w } = await open();
    const result = await createLab(
      database,
      w.coTeacher,
      { simulationId: w.simulationId, name: " Night Shift Lab " },
      NOW,
    );
    if (!result.ok) throw new Error(result.error);
    expect(parseLabId(result.value.labId)).toBe(result.value.labId);
    const row = await database
      .selectFrom("labs")
      .select(["name", "simulation_id"])
      .where("id", "=", result.value.labId)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ name: "Night Shift Lab", simulation_id: w.simulationId });
    expect(await auditRows(database, "lab_created")).toEqual(
      expect.arrayContaining([
        {
          actor_id: w.coTeacher.id,
          outcome: "success",
          target_type: "lab",
          target_id: result.value.labId,
          reason_code: null,
          metadata: { simulation_id: w.simulationId },
        },
      ]),
    );
  });

  it("refuses a name the simulation uses, in any case (#280)", async () => {
    const { database, w } = await open();
    const result = await createLab(
      database,
      w.teacher,
      { simulationId: w.simulationId, name: "PIPETTE pilots" },
      NOW,
    );
    expect(result).toEqual({ ok: false, error: "lab_name_taken" });
  });

  it("allows a name another simulation uses", async () => {
    const { database, w } = await open();
    const result = await createLab(
      database,
      w.teacher,
      { simulationId: w.simulationId, name: "Lab Osprey" },
      NOW,
    );
    expect(result.ok).toBe(true);
  });

  it("holds the unique name in the database too, case-insensitively", async () => {
    const { database, w } = await open();
    await expect(
      database
        .insertInto("labs")
        .values({ simulation_id: w.simulationId, name: "blue cuvettes" })
        .execute(),
    ).rejects.toThrow(/labs_simulation_id_name_key/);
  });

  teacherWriteRefusals({
    call: (database, _w, actor, target) =>
      createLab(database, actor, { simulationId: target, name: "Side door" }, NOW),
    target: (w) => ({ type: "simulation", id: w.simulationId }),
  });
});

describe("renameLab (D10)", () => {
  it("renames a lab, logged", async () => {
    const { database, w } = await open();
    const result = await renameLab(database, w.teacher, { labId: w.labId, name: "Helix" }, NOW);
    expect(result).toEqual({ ok: true, value: null });
    const row = await database
      .selectFrom("labs")
      .select("name")
      .where("id", "=", w.labId)
      .executeTakeFirstOrThrow();
    expect(row.name).toBe("Helix");
    expect(await auditRows(database, "lab_renamed")).toEqual([
      expect.objectContaining({ outcome: "success", target_id: w.labId }),
    ]);
  });

  it("allows a change of case of its own name, and refuses another lab's name", async () => {
    const { database, w } = await open();
    const own = await renameLab(
      database,
      w.teacher,
      { labId: w.labId, name: "PIPETTE PILOTS" },
      NOW,
    );
    expect(own.ok).toBe(true);
    const other = await renameLab(
      database,
      w.teacher,
      { labId: w.labId, name: "Blue Cuvettes" },
      NOW,
    );
    expect(other).toEqual({ ok: false, error: "lab_name_taken" });
  });

  teacherWriteRefusals({
    call: (database, _w, actor, target) =>
      renameLab(database, actor, { labId: target, name: "Taken over" }, NOW),
    target: (w) => ({ type: "lab", id: w.labId }),
  });
});

describe("deleteLab (#280)", () => {
  it("deletes a lab with its places and waiting addresses, logged", async () => {
    const { database, w } = await open();
    await database
      .insertInto("lab_member_emails")
      .values({ simulation_id: w.simulationId, lab_id: w.labId, email: "waits@example.test" })
      .execute();
    const result = await deleteLab(database, w.teacher, { labId: w.labId });
    expect(result).toEqual({ ok: true, value: null });
    const [members, emails] = await Promise.all([
      database.selectFrom("lab_members").select("user_id").where("lab_id", "=", w.labId).execute(),
      database
        .selectFrom("lab_member_emails")
        .select("email")
        .where("lab_id", "=", w.labId)
        .execute(),
    ]);
    expect([members, emails]).toEqual([[], []]);
    expect(await auditRows(database, "lab_deleted")).toEqual([
      expect.objectContaining({
        outcome: "success",
        target_id: w.labId,
        metadata: { simulation_id: w.simulationId },
      }),
    ]);
  });

  teacherWriteRefusals({
    call: (database, _w, actor, target) => deleteLab(database, actor, { labId: target }),
    target: (w) => ({ type: "lab", id: w.labId }),
  });
});
