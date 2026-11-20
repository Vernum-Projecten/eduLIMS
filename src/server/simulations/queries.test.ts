// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { png } from "../logo/test-images.ts";
import {
  getCurrentStudentLab,
  getTeacherLab,
  getTeacherSimulation,
  listTeacherSimulations,
} from "./queries.ts";
import { findStudentLab } from "./student-access.ts";
import {
  notFoundLine,
  type Person,
  place,
  securityLines,
  setState,
  type World,
  world,
} from "./test-helpers.ts";

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
        state: "prepared",
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
      {
        id: w.otherLabId,
        name: "Blue Cuvettes",
        members: 1,
        waiting: 1,
        logoVersion: null,
        joinCode: "off",
      },
      {
        id: w.labId,
        name: "Pipette Pilots",
        members: 6,
        waiting: 0,
        logoVersion: null,
        joinCode: "off",
      },
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

describe("getCurrentStudentLab (S10, #379)", () => {
  it("gives the student's own lab with its simulation and state, and nothing else", async () => {
    const { database, w } = await open();
    expect(await getCurrentStudentLab(database, w.student.id)).toEqual({
      labId: w.labId,
      labName: "Pipette Pilots",
      simulationId: w.simulationId,
      simulationName: "Practice simulation",
      state: "prepared",
      logoVersion: null,
    });
  });

  it("gives a student of another lab only that lab", async () => {
    const { database, w } = await open();
    expect((await getCurrentStudentLab(database, w.otherLabStudent.id))?.labId).toBe(w.otherLabId);
  });

  it("gives a student outside the simulation only their own simulation's lab", async () => {
    const { database, w } = await open();
    expect((await getCurrentStudentLab(database, w.outsideStudent.id))?.labId).toBe(w.outsideLabId);
  });

  it.each([
    ["a teacher of the simulation", (w: World) => w.teacher],
    ["an administrator", (w: World) => w.admin],
    ["a student in no lab", (w: World) => w.stranger],
  ])("gives nothing to %s", async (_who, actorOf) => {
    const { database, w } = await open();
    expect(await getCurrentStudentLab(database, actorOf(w).id)).toBeNull();
  });

  it("gives the lab of the unfinished simulation over a finished one (#379)", async () => {
    const { database, w } = await open();
    await setState(database, w.simulationId, "finished");
    await place(database, w.outsideSimulationId, w.outsideLabId, w.student.id);
    const lab = await getCurrentStudentLab(database, w.student.id);
    expect(lab).toEqual(expect.objectContaining({ labId: w.outsideLabId, state: "prepared" }));
  });

  it("gives the most recently finished lab, read-only, when every simulation is finished (#379)", async () => {
    const { database, w } = await open();
    await setState(database, w.outsideSimulationId, "finished", new Date("2026-11-01T09:00:00Z"));
    await place(database, w.outsideSimulationId, w.outsideLabId, w.student.id);
    await setState(database, w.simulationId, "finished", new Date("2026-11-10T09:00:00Z"));
    expect(await getCurrentStudentLab(database, w.student.id)).toEqual(
      expect.objectContaining({ labId: w.labId, state: "finished" }),
    );
  });

  it("returns names, ids, the state and the logo version only: no member, address or teacher (Q-SIM-1)", async () => {
    const { database, w } = await open();
    const row = await getCurrentStudentLab(database, w.student.id);
    expect(Object.keys(row ?? {}).sort()).toEqual([
      "labId",
      "labName",
      "logoVersion",
      "simulationId",
      "simulationName",
      "state",
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

describe("the logo version of each read (#293)", () => {
  async function storeLogo(
    database: Kysely<DB>,
    w: World,
    labId = w.labId,
    side = 4,
  ): Promise<string> {
    const content = Buffer.from(png(side, side));
    const sha256 = createHash("sha256").update(content).digest();
    await database
      .insertInto("lab_logos")
      .values({
        lab_id: labId,
        content,
        media_type: "image/png",
        byte_size: content.length,
        width: side,
        height: side,
        sha256,
        updated_by: w.teacher.id,
      })
      .execute();
    return sha256.toString("hex").slice(0, 16);
  }

  it("gives a student in two simulations the current lab's own version (V8.2.2, #379)", async () => {
    const { database, w } = await open();
    await setState(database, w.simulationId, "finished");
    await place(database, w.outsideSimulationId, w.outsideLabId, w.student.id);
    const mine = await storeLogo(database, w, w.labId, 4);
    const outside = await storeLogo(database, w, w.outsideLabId, 6);
    const lab = await getCurrentStudentLab(database, w.student.id);
    expect(lab).toEqual(expect.objectContaining({ labId: w.outsideLabId, logoVersion: outside }));
    expect(mine).not.toBe(outside);
  });

  it("gives a teacher of another simulation nothing of a lab with a stored logo (V8.2.2)", async () => {
    const { database, w } = await open();
    await storeLogo(database, w);
    expect(await getTeacherLab(database, w.outsiderTeacher.id, w.labId)).toBeNull();
    expect(await getTeacherSimulation(database, w.outsiderTeacher.id, w.simulationId)).toBeNull();
    const own = await getTeacherSimulation(database, w.outsiderTeacher.id, w.outsideSimulationId);
    expect(own?.labs.map((lab) => lab.logoVersion)).toEqual([null]);
  });

  it("gives the lab with a logo its version and the lab without one null", async () => {
    const { database, w } = await open();
    const version = await storeLogo(database, w);
    const page = await getTeacherSimulation(database, w.teacher.id, w.simulationId);
    expect(page?.labs.map((lab) => [lab.id, lab.logoVersion])).toEqual([
      [w.otherLabId, null],
      [w.labId, version],
    ]);
    expect((await getTeacherLab(database, w.teacher.id, w.labId))?.logoVersion).toBe(version);
    expect((await getTeacherLab(database, w.teacher.id, w.otherLabId))?.logoVersion).toBeNull();
  });

  it("gives the student of the lab its version, and a student of another lab none of it", async () => {
    const { database, w } = await open();
    const version = await storeLogo(database, w);
    expect((await getCurrentStudentLab(database, w.student.id))?.logoVersion).toBe(version);
    expect((await getCurrentStudentLab(database, w.otherLabStudent.id))?.logoVersion).toBeNull();
  });

  it("changes the version when the logo is replaced", async () => {
    const { database, w } = await open();
    const first = await storeLogo(database, w);
    const content = Buffer.from(png(5, 5));
    await database
      .updateTable("lab_logos")
      .set({
        content,
        byte_size: content.length,
        width: 5,
        height: 5,
        sha256: createHash("sha256").update(content).digest(),
      })
      .where("lab_id", "=", w.labId)
      .execute();
    const page = await getTeacherLab(database, w.teacher.id, w.labId);
    expect(page?.logoVersion).toMatch(/^[0-9a-f]{16}$/);
    expect(page?.logoVersion).not.toBe(first);
  });
});
