// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { addTeacher, removeTeacher } from "./teachers.ts";
import { teacherWriteRefusals } from "./test-access.ts";
import { auditRows, NOW, person, type World, world } from "./test-helpers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function open(): Promise<{ database: Kysely<DB>; w: World }> {
  db = await createTestDb();
  return { database: db, w: await world(db) };
}

async function teachersOf(database: Kysely<DB>, simulationId: string) {
  const rows = await database
    .selectFrom("simulation_teachers")
    .select("user_id")
    .where("simulation_id", "=", simulationId)
    .orderBy("user_id")
    .execute();
  return rows.map((row) => row.user_id).sort();
}

describe("addTeacher (D10: other teachers, with the same rights)", () => {
  it("adds an existing teacher account by its address, any case, logged with the id", async () => {
    const { database, w } = await open();
    const result = await addTeacher(
      database,
      w.teacher,
      { simulationId: w.simulationId, email: "  OUTSIDER-teacher@Example.test " },
      NOW,
    );
    expect(result).toEqual({ ok: true, value: { userId: w.outsiderTeacher.id } });
    expect(await teachersOf(database, w.simulationId)).toEqual(
      [w.teacher.id, w.coTeacher.id, w.outsiderTeacher.id].sort(),
    );
    const rows = await auditRows(database, "simulation_teacher_added");
    expect(rows).toEqual([
      expect.objectContaining({
        actor_id: w.teacher.id,
        outcome: "success",
        target_id: w.simulationId,
        metadata: { user_id: w.outsiderTeacher.id },
      }),
    ]);
    expect(JSON.stringify(rows)).not.toContain("@");
  });

  it("never adds a teacher whose stored address is a KELVIN SIGN look-alike (#311)", async () => {
    const { database, w } = await open();
    const kelvin = await person(database, "kelvin-teacher", ["teacher"]);
    await database
      .updateTable("user")
      .set({ email: "Kim@example.test" })
      .where("id", "=", kelvin.id)
      .execute();
    const result = await addTeacher(
      database,
      w.teacher,
      { simulationId: w.simulationId, email: "kim@example.test" },
      NOW,
    );
    expect(result).toEqual({ ok: false, error: "not_a_teacher" });
    expect(await teachersOf(database, w.simulationId)).toEqual(
      [w.teacher.id, w.coTeacher.id].sort(),
    );
  });

  it("adds a teacher-administrator, who holds the teacher role", async () => {
    const { database, w } = await open();
    const both = await person(database, "coordinator", ["teacher", "admin"]);
    const result = await addTeacher(
      database,
      w.teacher,
      { simulationId: w.simulationId, email: both.email },
      NOW,
    );
    expect(result.ok).toBe(true);
  });

  it.each([
    ["an unknown address", "nobody@example.test"],
    ["a student's address", "student-1@example.test"],
    ["an administrator's address", "admin@example.test"],
  ])("refuses %s with the same not_a_teacher, logged without the address", async (_c, email) => {
    const { database, w } = await open();
    const before = await teachersOf(database, w.simulationId);
    const result = await addTeacher(
      database,
      w.teacher,
      { simulationId: w.simulationId, email },
      NOW,
    );
    expect(result).toEqual({ ok: false, error: "not_a_teacher" });
    expect(await teachersOf(database, w.simulationId)).toEqual(before);
    const rows = await auditRows(database, "simulation_teacher_added");
    expect(rows).toEqual([
      {
        actor_id: w.teacher.id,
        outcome: "refused",
        target_type: "simulation",
        target_id: w.simulationId,
        reason_code: "not_a_teacher",
        metadata: null,
      },
    ]);
  });

  it("answers already_teacher for a teacher of the simulation, and logs no change", async () => {
    const { database, w } = await open();
    const result = await addTeacher(
      database,
      w.teacher,
      { simulationId: w.simulationId, email: w.coTeacher.email },
      NOW,
    );
    expect(result).toEqual({ ok: false, error: "already_teacher" });
    expect(await auditRows(database, "simulation_teacher_added")).toEqual([]);
  });

  teacherWriteRefusals({
    call: (database, w, actor, target) =>
      addTeacher(database, actor, { simulationId: target, email: w.outsiderTeacher.email }, NOW),
    target: (w) => ({ type: "simulation", id: w.simulationId }),
  });
});

describe("removeTeacher (D10)", () => {
  it("removes a co-teacher, logged with the id", async () => {
    const { database, w } = await open();
    const result = await removeTeacher(database, w.teacher, {
      simulationId: w.simulationId,
      userId: w.coTeacher.id,
    });
    expect(result).toEqual({ ok: true, value: null });
    expect(await teachersOf(database, w.simulationId)).toEqual([w.teacher.id]);
    expect(await auditRows(database, "simulation_teacher_removed")).toEqual([
      expect.objectContaining({
        outcome: "success",
        target_id: w.simulationId,
        metadata: { user_id: w.coTeacher.id },
      }),
    ]);
  });

  it("lets a teacher remove themselves while another teacher stays", async () => {
    const { database, w } = await open();
    const result = await removeTeacher(database, w.coTeacher, {
      simulationId: w.simulationId,
      userId: w.coTeacher.id,
    });
    expect(result.ok).toBe(true);
    expect(await teachersOf(database, w.simulationId)).toEqual([w.teacher.id]);
  });

  it("counts no teacher row whose user lost the teacher role (#300 review, S1)", async () => {
    const { database, w } = await open();
    await database
      .updateTable("user")
      .set({ role: "student" })
      .where("id", "=", w.coTeacher.id)
      .execute();
    const result = await removeTeacher(database, w.teacher, {
      simulationId: w.simulationId,
      userId: w.teacher.id,
    });
    expect(result).toEqual({ ok: false, error: "last_teacher" });
    expect(await teachersOf(database, w.simulationId)).toEqual(
      [w.teacher.id, w.coTeacher.id].sort(),
    );
    expect(await auditRows(database, "simulation_teacher_removed")).toEqual([
      expect.objectContaining({ outcome: "refused", reason_code: "last_teacher" }),
    ]);
  });

  it("never removes the last teacher, and logs the refusal", async () => {
    const { database, w } = await open();
    await removeTeacher(database, w.teacher, {
      simulationId: w.simulationId,
      userId: w.coTeacher.id,
    });
    const result = await removeTeacher(database, w.teacher, {
      simulationId: w.simulationId,
      userId: w.teacher.id,
    });
    expect(result).toEqual({ ok: false, error: "last_teacher" });
    expect(await teachersOf(database, w.simulationId)).toEqual([w.teacher.id]);
    expect(await auditRows(database, "simulation_teacher_removed")).toEqual([
      expect.objectContaining({ outcome: "success" }),
      expect.objectContaining({ outcome: "refused", reason_code: "last_teacher" }),
    ]);
  });

  it("answers teacher_not_found for someone who does not teach it", async () => {
    const { database, w } = await open();
    const result = await removeTeacher(database, w.teacher, {
      simulationId: w.simulationId,
      userId: w.outsiderTeacher.id,
    });
    expect(result).toEqual({ ok: false, error: "teacher_not_found" });
  });

  teacherWriteRefusals({
    call: (database, w, actor, target) =>
      removeTeacher(database, actor, { simulationId: target, userId: w.coTeacher.id }),
    target: (w) => ({ type: "simulation", id: w.simulationId }),
  });
});
