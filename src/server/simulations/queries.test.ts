// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import {
  getTeacherLab,
  getTeacherSimulation,
  listStudentLabs,
  listTeacherSimulations,
} from "./queries.ts";
import { findStudentLab } from "./student-access.ts";
import { notFoundLine, type Person, securityLines, type World, world } from "./test-helpers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function open(): Promise<{ database: Kysely<DB>; w: World }> {
  db = await createTestDb();
  return { database: db, w: await world(db) };
}

/** The people who are not a teacher of the world's first simulation (D11, R-01). */
const NOT_ITS_TEACHER: [string, (w: World) => Person][] = [
  ["a student of the lab", (w) => w.student],
  ["a student of another lab", (w) => w.otherLabStudent],
  ["a student outside the simulation", (w) => w.outsideStudent],
  ["a teacher of another simulation", (w) => w.outsiderTeacher],
  ["an administrator", (w) => w.admin],
];

describe("listTeacherSimulations (D11: only their own simulations)", () => {
  it("lists the simulations the teacher teaches, with their counts", async () => {
    const { database, w } = await open();
    const rows = await listTeacherSimulations(database, w.coTeacher.id);
    expect(rows).toEqual([
      {
        id: w.simulationId,
        name: "Practice simulation",
        createdAt: expect.any(String),
        labs: 2,
        members: 7,
        teachers: 2,
      },
    ]);
  });

  it.each(NOT_ITS_TEACHER)("never lists the simulation to %s", async (_who, actorOf) => {
    const { database, w } = await open();
    const rows = await listTeacherSimulations(database, actorOf(w).id);
    expect(rows.map((row) => row.id)).not.toContain(w.simulationId);
  });
});

describe("getTeacherSimulation (D10, D11)", () => {
  it("returns its labs with counts and its teachers, by name", async () => {
    const { database, w } = await open();
    await database
      .insertInto("lab_member_emails")
      .values({ simulation_id: w.simulationId, lab_id: w.otherLabId, email: "waits@example.test" })
      .execute();
    const page = await getTeacherSimulation(database, w.teacher.id, w.simulationId);
    expect(page?.labs).toEqual([
      { id: w.otherLabId, name: "Blue Cuvettes", members: 1, waiting: 1 },
      { id: w.labId, name: "Pipette Pilots", members: 6, waiting: 0 },
    ]);
    expect(page?.teachers.map((teacher) => teacher.userId).sort()).toEqual(
      [w.teacher.id, w.coTeacher.id].sort(),
    );
  });

  it.each(NOT_ITS_TEACHER)(
    "returns null to %s and logs the probe (V16.3.2)",
    async (_w, actorOf) => {
      const { database, w } = await open();
      const actor = actorOf(w);
      let page: unknown;
      const lines = await securityLines(async () => {
        page = await getTeacherSimulation(database, actor.id, w.simulationId);
      });
      expect(page).toBeNull();
      expect(lines).toEqual([notFoundLine(actor.id, "simulation", w.simulationId)]);
    },
  );

  it("returns null for a malformed or unknown id, and logs each", async () => {
    const { database, w } = await open();
    const unknown = "01960000-0000-7000-8000-000000000001";
    const pages: unknown[] = [];
    const lines = await securityLines(async () => {
      pages.push(await getTeacherSimulation(database, w.teacher.id, "not-a-uuid"));
      pages.push(await getTeacherSimulation(database, w.teacher.id, unknown));
    });
    expect(pages).toEqual([null, null]);
    expect(lines).toEqual([
      notFoundLine(w.teacher.id, "simulation", "not-a-uuid"),
      notFoundLine(w.teacher.id, "simulation", unknown),
    ]);
  });

  it("logs nothing for the teacher's own simulation", async () => {
    const { database, w } = await open();
    const lines = await securityLines(() =>
      getTeacherSimulation(database, w.teacher.id, w.simulationId),
    );
    expect(lines).toEqual([]);
  });
});

describe("getTeacherLab (D10, D11)", () => {
  it("returns a lab of six with its members, waiting addresses and the other labs", async () => {
    const { database, w } = await open();
    await database
      .insertInto("lab_member_emails")
      .values({ simulation_id: w.simulationId, lab_id: w.labId, email: "waits@example.test" })
      .execute();
    const page = await getTeacherLab(database, w.teacher.id, w.labId);
    expect(page?.members).toHaveLength(6);
    expect(page?.members.map((member) => member.userId)).toContain(w.student.id);
    expect(page?.waiting).toEqual([{ email: "waits@example.test", addedAt: expect.any(String) }]);
    expect(page?.otherLabs).toEqual([{ id: w.otherLabId, name: "Blue Cuvettes" }]);
    expect(page?.simulation).toEqual({ id: w.simulationId, name: "Practice simulation" });
  });

  it.each(NOT_ITS_TEACHER)(
    "returns null to %s and logs the probe (V16.3.2)",
    async (_w, actorOf) => {
      const { database, w } = await open();
      const actor = actorOf(w);
      let page: unknown;
      const lines = await securityLines(async () => {
        page = await getTeacherLab(database, actor.id, w.labId);
      });
      expect(page).toBeNull();
      expect(lines).toEqual([notFoundLine(actor.id, "lab", w.labId)]);
    },
  );

  it("returns null for a malformed id, and logs it", async () => {
    const { database, w } = await open();
    let page: unknown;
    const lines = await securityLines(async () => {
      page = await getTeacherLab(database, w.teacher.id, "not-a-uuid");
    });
    expect(page).toBeNull();
    expect(lines).toEqual([notFoundLine(w.teacher.id, "lab", "not-a-uuid")]);
  });
});

describe("listStudentLabs (S10)", () => {
  it("lists the student's own lab with its simulation, and nothing else", async () => {
    const { database, w } = await open();
    expect(await listStudentLabs(database, w.student.id)).toEqual([
      {
        labId: w.labId,
        labName: "Pipette Pilots",
        simulationId: w.simulationId,
        simulationName: "Practice simulation",
      },
    ]);
  });

  it("gives a student of another lab only that lab", async () => {
    const { database, w } = await open();
    const rows = await listStudentLabs(database, w.otherLabStudent.id);
    expect(rows.map((row) => row.labId)).toEqual([w.otherLabId]);
  });

  it("gives a student outside the simulation only their own simulation's lab", async () => {
    const { database, w } = await open();
    const rows = await listStudentLabs(database, w.outsideStudent.id);
    expect(rows.map((row) => row.labId)).toEqual([w.outsideLabId]);
  });

  it.each([
    ["a teacher of the simulation", (w: World) => w.teacher],
    ["an administrator", (w: World) => w.admin],
    ["a student in no lab", (w: World) => w.stranger],
  ])("lists nothing for %s", async (_who, actorOf) => {
    const { database, w } = await open();
    expect(await listStudentLabs(database, actorOf(w).id)).toEqual([]);
  });

  it("returns names and ids only: no member, address or teacher (Q-SIM-1)", async () => {
    const { database, w } = await open();
    const [row] = await listStudentLabs(database, w.student.id);
    expect(Object.keys(row ?? {}).sort()).toEqual([
      "labId",
      "labName",
      "simulationId",
      "simulationName",
    ]);
  });
});

describe("findStudentLab (the student lab predicate, S10, for #268)", () => {
  it("finds the lab of a member, with its simulation", async () => {
    const { database, w } = await open();
    expect(await findStudentLab(database, w.student.id, w.labId)).toEqual({
      labId: w.labId,
      simulationId: w.simulationId,
    });
  });

  it.each([
    ["a student of another lab", (w: World) => w.otherLabStudent],
    ["a student outside the simulation", (w: World) => w.outsideStudent],
    ["a teacher of the simulation", (w: World) => w.teacher],
    ["a teacher of another simulation", (w: World) => w.outsiderTeacher],
    ["an administrator", (w: World) => w.admin],
  ])("refuses %s", async (_who, actorOf) => {
    const { database, w } = await open();
    expect(await findStudentLab(database, actorOf(w).id, w.labId)).toBeNull();
  });

  it("refuses a malformed and an unknown lab id alike", async () => {
    const { database, w } = await open();
    expect(await findStudentLab(database, w.student.id, "not-a-uuid")).toBeNull();
    expect(
      await findStudentLab(database, w.student.id, "01960000-0000-7000-8000-000000000001"),
    ).toBeNull();
  });

  it("stops at once when a teacher moves the student to another lab", async () => {
    const { database, w } = await open();
    await database
      .updateTable("lab_members")
      .set({ lab_id: w.otherLabId })
      .where("user_id", "=", w.student.id)
      .execute();
    expect(await findStudentLab(database, w.student.id, w.labId)).toBeNull();
    expect(await findStudentLab(database, w.student.id, w.otherLabId)).not.toBeNull();
  });
});
