// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { type Kysely, sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { parseLabId } from "../../lib/simulations.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { createLab, deleteLab, renameLab } from "./labs.ts";
import { deleteSimulation } from "./simulations.ts";
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

  it.each([
    ["Lab İstanbul", "lab i̇stanbul"],
    ["Lab Σigma", "lab σigma"],
    ["Lab ǅ", "lab ǆ"],
    ["Lab Kelvin", "lab Kelvin"],
  ])("decides %s against %s as the unique index does, never with a 500", async (first, second) => {
    const { database, w } = await open();
    const created = await createLab(
      database,
      w.teacher,
      { simulationId: w.simulationId, name: first },
      NOW,
    );
    expect(created.ok).toBe(true);
    const { rows } = await sql<{
      same: boolean;
    }>`select lower(${first}::text) = lower(${second}::text) as same`.execute(database);
    const same = rows[0]?.same === true;
    const result = await createLab(
      database,
      w.teacher,
      { simulationId: w.simulationId, name: second },
      NOW,
    );
    expect(result.ok).toBe(!same);
    if (!result.ok) expect(result.error).toBe("lab_name_taken");
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
  it("refuses a lab with a student in it, logged, and deletes nothing (#300 review, S3)", async () => {
    const { database, w } = await open();
    const result = await deleteLab(database, w.teacher, { labId: w.labId });
    // NOTE: #352; a lab's own refusal code, so the screen and the log name the lab, not the
    // simulation.
    expect(result).toEqual({ ok: false, error: "lab_has_students" });
    const members = await database
      .selectFrom("lab_members")
      .select("user_id")
      .where("lab_id", "=", w.labId)
      .execute();
    expect(members).toHaveLength(6);
    expect(await auditRows(database, "lab_deleted")).toEqual([
      expect.objectContaining({
        outcome: "refused",
        reason_code: "lab_has_students",
        target_id: w.labId,
      }),
    ]);
  });

  it("gives no way round deleteSimulation's has_students by deleting the labs first", async () => {
    const { database, w } = await open();
    for (const labId of [w.labId, w.otherLabId]) {
      expect(await deleteLab(database, w.teacher, { labId })).toEqual({
        ok: false,
        error: "lab_has_students",
      });
    }
    expect(await deleteSimulation(database, w.teacher, { simulationId: w.simulationId })).toEqual({
      ok: false,
      error: "has_students",
    });
  });

  it("deletes an empty lab with its waiting addresses, logged", async () => {
    const { database, w } = await open();
    await database.deleteFrom("lab_members").where("lab_id", "=", w.labId).execute();
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
