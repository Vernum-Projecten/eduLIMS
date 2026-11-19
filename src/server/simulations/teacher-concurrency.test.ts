// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The last teacher of a simulation on a committed database (D10, #300 review S2): the deferred
// constraint trigger of migration 0012 refuses a commit that leaves a simulation without a teacher
// row, so the guarded account deletion and `removeTeacher` cannot both win.
import { afterEach, describe, expect, it } from "vitest";
import { type CommittedTestDb, createCommittedTestDb } from "../db/test-committed-db.ts";
import { parseEnv } from "../env.ts";
import { createTestAuth } from "../test-auth.ts";
import { VALID_ENV } from "../test-env.ts";
import { createUser, signIn } from "../users/test-helpers.ts";
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

  it("never leaves zero teachers when an account deletion and removeTeacher race", async () => {
    const db = await open();
    const auth = await createTestAuth(parseEnv({ ...VALID_ENV, EDULIMS_DEV_LOGIN: "true" }), {
      db,
      type: "postgres",
    });
    await createUser(auth, "admin@example.test", ["admin"]);
    const headers = await signIn(auth, "admin@example.test");
    for (const round of [1, 2, 3, 4, 5]) {
      const firstId = await createUser(auth, `first-${round}@example.test`, ["teacher"]);
      const secondId = await createUser(auth, `second-${round}@example.test`, ["teacher"]);
      const first = { id: firstId, roles: ["teacher"] as const };
      const second = { id: secondId, roles: ["teacher"] as const };
      const created = await createSimulation(db, first, { name: `Race ${round}` }, NOW);
      if (!created.ok) throw new Error(created.error);
      const { simulationId } = created.value;
      await db
        .insertInto("simulation_teachers")
        .values({ simulation_id: simulationId, user_id: secondId, added_by: firstId })
        .execute();
      const [deletion, removal] = await Promise.allSettled([
        auth.api.removeUser({ body: { userId: firstId }, headers }),
        removeTeacher(db, second, { simulationId, userId: secondId }),
      ]);
      const removalRefused =
        removal.status === "fulfilled" &&
        !removal.value.ok &&
        removal.value.error === "last_teacher";
      expect([round, deletion.status === "rejected" || removalRefused]).toEqual([round, true]);
      const left = await db
        .selectFrom("simulation_teachers")
        .select("user_id")
        .where("simulation_id", "=", simulationId)
        .execute();
      expect(left.length).toBeGreaterThanOrEqual(1);
    }
  });
});
