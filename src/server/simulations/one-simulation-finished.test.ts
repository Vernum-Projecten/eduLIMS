// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// A finished simulation is history (maintainer on the review of #392, N1 and N2): a move in it is
// `not_running`, a join with a code of its lab is `simulation_finished`, a waiting address of it
// never links, and finishing deletes its labs' join codes. Also the trigger of migration 0026
// against one statement that writes two rows.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { joinLabWithCode } from "./join.ts";
import { enableJoinCode, getJoinCode, regenerateJoinCode } from "./join-code.ts";
import { linkWaitingAddresses } from "./linking.ts";
import { moveMember } from "./members.ts";
import { finishSimulation, startSimulation } from "./state.ts";
import { auditRows, NOW, person, setState, startable, type World, world } from "./test-helpers.ts";
import { codeOf, context, key, labOf } from "./test-join.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function open(): Promise<{ database: Kysely<DB>; w: World }> {
  db = await createTestDb();
  return { database: db, w: await world(db) };
}

describe("one statement that writes two places (#379, review of #392)", () => {
  it("refuses a multi-row insert that puts a student in two unfinished simulations", async () => {
    const { database, w } = await open();
    await expect(
      database
        .insertInto("lab_members")
        .values([
          {
            simulation_id: w.simulationId,
            lab_id: w.labId,
            user_id: w.stranger.id,
            joined_via: "code",
          },
          {
            simulation_id: w.outsideSimulationId,
            lab_id: w.outsideLabId,
            user_id: w.stranger.id,
            joined_via: "code",
          },
        ])
        .execute(),
    ).rejects.toMatchObject({ code: "23514", constraint: "lab_members_one_active_simulation" });
  });
});

describe("a move in a finished simulation (review of #392, N1)", () => {
  it("is refused with not_running, logged, and the student stays", async () => {
    const { database, w } = await open();
    await setState(database, w.simulationId, "finished");
    const result = await moveMember(database, w.teacher, {
      simulationId: w.simulationId,
      userId: w.student.id,
      labId: w.otherLabId,
    });
    expect(result).toEqual({ ok: false, error: "not_running" });
    expect(await labOf(database, w.simulationId, w.student.id)).toEqual(
      expect.objectContaining({ lab_id: w.labId }),
    );
    expect(await auditRows(database, "lab_member_moved")).toEqual([
      expect.objectContaining({
        actor_id: w.teacher.id,
        outcome: "refused",
        reason_code: "not_running",
        target_id: w.otherLabId,
      }),
    ]);
  });
});

describe("a join into a finished simulation (review of #392, N2)", () => {
  it("is refused with simulation_finished, logged once, free of charge", async () => {
    const { database, w } = await open();
    const code = await codeOf(database, w.teacher, w.labId);
    await setState(database, w.simulationId, "finished");
    for (let i = 0; i < 4; i += 1) {
      expect(await joinLabWithCode(database, w.stranger, { code }, context())).toEqual({
        ok: false,
        error: "simulation_finished",
      });
    }
    expect(await labOf(database, w.simulationId, w.stranger.id)).toBeNull();
    expect(await auditRows(database, "lab_join_failed")).toEqual([
      expect.objectContaining({
        actor_id: w.stranger.id,
        outcome: "refused",
        reason_code: "simulation_finished",
        target_id: w.labId,
      }),
    ]);
  });

  it("is refused for a student in no other simulation too: the target alone decides", async () => {
    const { database, w } = await open();
    const code = await codeOf(database, w.outsiderTeacher, w.outsideLabId);
    await setState(database, w.outsideSimulationId, "finished");
    const fresh = await person(database, "fresh", ["student"]);
    expect(await joinLabWithCode(database, fresh, { code }, context())).toEqual({
      ok: false,
      error: "simulation_finished",
    });
  });
});

describe("finishing a simulation (review of #392, N2)", () => {
  it("deletes its labs' join codes and logs their count, so a code stops working", async () => {
    const { database, w } = await open();
    const code = await codeOf(database, w.teacher, w.labId);
    await codeOf(database, w.teacher, w.otherLabId);
    await startable(database, w.simulationId);
    await codeOf(database, w.outsiderTeacher, w.outsideLabId);
    expect(
      (await startSimulation(database, w.teacher, { simulationId: w.simulationId }, NOW)).ok,
    ).toBe(true);
    expect(
      (await finishSimulation(database, w.teacher, { simulationId: w.simulationId }, NOW)).ok,
    ).toBe(true);
    const left = await database.selectFrom("lab_join_codes").select("lab_id").execute();
    expect(left).toEqual([{ lab_id: w.outsideLabId }]);
    expect(
      (await auditRows(database, "simulation_finished")).map((row) => [row.outcome, row.metadata]),
    ).toEqual([["success", { count: 2 }]]);
    expect(await joinLabWithCode(database, w.stranger, { code }, context())).toEqual({
      ok: false,
      error: "invalid_code",
    });
  });
});

describe("a waiting address of a finished simulation (review of #392, N2)", () => {
  it("never links and is never locked", async () => {
    const { database, w } = await open();
    await database
      .insertInto("lab_member_emails")
      .values({ simulation_id: w.simulationId, lab_id: w.labId, email: w.stranger.email })
      .execute();
    await setState(database, w.simulationId, "finished");
    expect(await linkWaitingAddresses(database, w.stranger.id, NOW)).toEqual({
      linked: 0,
      refused: 0,
      failed: 0,
    });
    expect(await labOf(database, w.simulationId, w.stranger.id)).toBeNull();
  });
});

describe("a join code in a finished simulation (coordinator on #399)", () => {
  const settings = { validDays: 7, maxUses: 30 };

  it("cannot be turned on: simulation_finished, logged, and no code row", async () => {
    const { database, w } = await open();
    await setState(database, w.simulationId, "finished");
    expect(
      await enableJoinCode(database, w.teacher, { labId: w.labId, ...settings }, NOW, key),
    ).toEqual({ ok: false, error: "simulation_finished" });
    expect(await database.selectFrom("lab_join_codes").select("lab_id").execute()).toEqual([]);
    expect(await auditRows(database, "lab_join_code_enabled")).toEqual([
      expect.objectContaining({
        actor_id: w.teacher.id,
        outcome: "refused",
        reason_code: "simulation_finished",
        target_id: w.labId,
      }),
    ]);
  });

  it("cannot be made new, even when a code row is left: simulation_finished, logged", async () => {
    const { database, w } = await open();
    await codeOf(database, w.teacher, w.labId);
    await setState(database, w.simulationId, "finished");
    expect(
      await regenerateJoinCode(database, w.teacher, { labId: w.labId, ...settings }, NOW, key),
    ).toEqual({ ok: false, error: "simulation_finished" });
    expect(await auditRows(database, "lab_join_code_regenerated")).toEqual([
      expect.objectContaining({ outcome: "refused", reason_code: "simulation_finished" }),
    ]);
  });

  it("reads as off and finished on the lab page, so the panel offers no action", async () => {
    const { database, w } = await open();
    await setState(database, w.simulationId, "finished");
    expect(await getJoinCode(database, w.teacher, w.labId, NOW, key.fingerprint)).toEqual({
      enabled: false,
      finished: true,
    });
  });
});
