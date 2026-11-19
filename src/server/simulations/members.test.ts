// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { moveMember, removeMember } from "./members.ts";
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

async function labOf(database: Kysely<DB>, simulationId: string, userId: string) {
  const row = await database
    .selectFrom("lab_members")
    .select("lab_id")
    .where("simulation_id", "=", simulationId)
    .where("user_id", "=", userId)
    .executeTakeFirst();
  return row?.lab_id ?? null;
}

describe("moveMember (S10: one lab per simulation)", () => {
  it("moves a student to another lab of the simulation, logged with the previous lab", async () => {
    const { database, w } = await open();
    const result = await moveMember(database, w.teacher, {
      simulationId: w.simulationId,
      userId: w.student.id,
      labId: w.otherLabId,
    });
    expect(result).toEqual({ ok: true, value: null });
    expect(await labOf(database, w.simulationId, w.student.id)).toBe(w.otherLabId);
    expect(await auditRows(database, "lab_member_moved")).toEqual([
      {
        actor_id: w.teacher.id,
        outcome: "success",
        target_type: "lab",
        target_id: w.otherLabId,
        reason_code: null,
        metadata: {
          simulation_id: w.simulationId,
          user_id: w.student.id,
          previous_lab_id: w.labId,
        },
      },
    ]);
  });

  it("answers not_found for a lab of another simulation and moves nobody", async () => {
    const { database, w } = await open();
    const result = await moveMember(database, w.teacher, {
      simulationId: w.simulationId,
      userId: w.student.id,
      labId: w.outsideLabId,
    });
    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(await labOf(database, w.simulationId, w.student.id)).toBe(w.labId);
  });

  it("answers not_found for a malformed target lab", async () => {
    const { database, w } = await open();
    const result = await moveMember(database, w.teacher, {
      simulationId: w.simulationId,
      userId: w.student.id,
      labId: "not-a-uuid",
    });
    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("answers member_not_found for a student of another simulation", async () => {
    const { database, w } = await open();
    const result = await moveMember(database, w.teacher, {
      simulationId: w.simulationId,
      userId: w.outsideStudent.id,
      labId: w.otherLabId,
    });
    expect(result).toEqual({ ok: false, error: "member_not_found" });
    expect(await labOf(database, w.outsideSimulationId, w.outsideStudent.id)).toBe(w.outsideLabId);
  });

  it("answers same_lab for a move to the student's own lab", async () => {
    const { database, w } = await open();
    const result = await moveMember(database, w.teacher, {
      simulationId: w.simulationId,
      userId: w.student.id,
      labId: w.labId,
    });
    expect(result).toEqual({ ok: false, error: "same_lab" });
  });

  it("holds the lab inside the simulation in the database too (composite foreign key)", async () => {
    const { database, w } = await open();
    await expect(
      database
        .updateTable("lab_members")
        .set({ lab_id: w.outsideLabId })
        .where("user_id", "=", w.student.id)
        .execute(),
    ).rejects.toThrow(/lab_members_lab_fk/);
  });

  it("holds one lab per student per simulation in the database too (primary key)", async () => {
    const { database, w } = await open();
    await expect(
      database
        .insertInto("lab_members")
        .values({
          simulation_id: w.simulationId,
          lab_id: w.otherLabId,
          user_id: w.student.id,
          joined_via: "code",
        })
        .execute(),
    ).rejects.toThrow(/lab_members_pk/);
  });

  teacherWriteRefusals({
    call: (database, w, actor, target) =>
      moveMember(database, actor, {
        simulationId: target,
        userId: w.student.id,
        labId: w.otherLabId,
      }),
    target: (w) => ({ type: "simulation", id: w.simulationId }),
  });
});

describe("removeMember (#280)", () => {
  it("removes a student with a removal record, logged with ids", async () => {
    const { database, w } = await open();
    const result = await removeMember(
      database,
      w.coTeacher,
      { simulationId: w.simulationId, userId: w.student.id },
      NOW,
    );
    expect(result).toEqual({ ok: true, value: null });
    expect(await labOf(database, w.simulationId, w.student.id)).toBeNull();
    const removal = await database
      .selectFrom("simulation_removals")
      .select(["user_id", "removed_by"])
      .where("simulation_id", "=", w.simulationId)
      .execute();
    expect(removal).toEqual([{ user_id: w.student.id, removed_by: w.coTeacher.id }]);
    expect(await auditRows(database, "lab_member_removed")).toEqual([
      expect.objectContaining({
        outcome: "success",
        target_id: w.labId,
        metadata: { simulation_id: w.simulationId, user_id: w.student.id },
      }),
    ]);
  });

  it("answers member_not_found for someone who is in no lab of the simulation", async () => {
    const { database, w } = await open();
    const result = await removeMember(
      database,
      w.teacher,
      { simulationId: w.simulationId, userId: w.stranger.id },
      NOW,
    );
    expect(result).toEqual({ ok: false, error: "member_not_found" });
    expect(await auditRows(database, "lab_member_removed")).toEqual([]);
  });

  teacherWriteRefusals({
    call: (database, w, actor, target) =>
      removeMember(database, actor, { simulationId: target, userId: w.student.id }, NOW),
    target: (w) => ({ type: "simulation", id: w.simulationId }),
  });
});
