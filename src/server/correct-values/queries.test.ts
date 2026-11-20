// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The teacher's read of correct values and limits (D10, D13, Q-SIM-1, Q-SEC-2): a teacher of the
// simulation reads them; a student of the simulation, a student outside it, a teacher of another
// simulation, a former teacher and an administrator read nothing.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { AuthError } from "../middleware.ts";
import {
  notFoundLine,
  type Person,
  person,
  securityLines,
  type World,
  world,
} from "../simulations/test-helpers.ts";
import { getCorrectValuesPage } from "./queries.ts";
import {
  catalogueTest,
  SECRET_RED,
  SECRET_VALUE,
  SECRET_YELLOW,
  seedSecrets,
} from "./test-helpers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function open() {
  db = await createTestDb();
  const w = await world(db);
  const testId = await seedSecrets(db, w);
  return { db, w, testId };
}

describe("the correct values of a simulation (D10, D13)", () => {
  it("are read by a teacher of the simulation, with the limits and the active tests", async () => {
    const { db: database, w, testId } = await open();
    const retired = await catalogueTest(database, "Retired (invented)", { retired: true });
    const page = await getCorrectValuesPage(database, w.coTeacher, w.simulationId);
    expect(page).toMatchObject({
      simulationId: w.simulationId,
      state: "prepared",
      values: [{ sampleNumber: "S-001", testId, value: SECRET_VALUE }],
      tests: [
        {
          id: testId,
          name: "Glucose (invented)",
          values: 1,
          retired: false,
          limits: { kind: "absolute", yellow: SECRET_YELLOW, red: SECRET_RED },
        },
      ],
    });
    expect(page?.options.map((option) => option.id)).toContain(testId);
    expect(page?.options.map((option) => option.id)).not.toContain(retired);
  });

  it("list a test with limits but no value yet, without limits as null", async () => {
    const { db: database, w } = await open();
    const other = await catalogueTest(database, "Albumin (invented)");
    await database
      .insertInto("correct_values")
      .values({ simulation_id: w.simulationId, test_id: other, sample_number: "S-002", value: "1" })
      .execute();
    const page = await getCorrectValuesPage(database, w.teacher, w.simulationId);
    expect(page?.tests.find((test) => test.id === other)?.limits).toBeNull();
  });

  const forbidden: [string, (w: World) => Person][] = [
    ["a student of the simulation", (w) => w.student],
    ["a student outside it", (w) => w.outsideStudent],
    ["an administrator", (w) => w.admin],
  ];
  for (const [who, actorOf] of forbidden) {
    it(`refuses ${who} with 403 (Q-SIM-1, R-13)`, async () => {
      const { db: database, w } = await open();
      const error = await getCorrectValuesPage(database, actorOf(w), w.simulationId).then(
        () => null,
        (thrown: unknown) => thrown,
      );
      expect(error).toBeInstanceOf(AuthError);
      expect(error).toMatchObject({ status: 403 });
    });
  }

  it("reads nothing for a teacher of another simulation, and logs the probe (D11)", async () => {
    const { db: database, w } = await open();
    let page: unknown;
    const lines = await securityLines(async () => {
      page = await getCorrectValuesPage(database, w.outsiderTeacher, w.simulationId);
    });
    expect(page).toBeNull();
    expect(lines).toEqual([notFoundLine(w.outsiderTeacher.id, "simulation", w.simulationId)]);
  });

  it("refuses a former teacher whose row stayed but whose app role is now student", async () => {
    const { db: database, w } = await open();
    const former = await person(database, "former-teacher", ["student"]);
    await database
      .insertInto("simulation_teachers")
      .values({ simulation_id: w.simulationId, user_id: former.id, added_by: w.teacher.id })
      .execute();
    await expect(getCorrectValuesPage(database, former, w.simulationId)).rejects.toBeInstanceOf(
      AuthError,
    );
  });

  it("reads nothing for a malformed id, and logs it", async () => {
    const { db: database, w } = await open();
    let page: unknown;
    const lines = await securityLines(async () => {
      page = await getCorrectValuesPage(database, w.teacher, "not-a-uuid");
    });
    expect(page).toBeNull();
    expect(lines).toEqual([notFoundLine(w.teacher.id, "simulation", "not-a-uuid")]);
  });
});
