// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The negative cases every teacher write of simulations and labs gets on its own (S10, D11,
// Q-SEC-2, R-01): a student of the lab, a student of another lab, a student outside the
// simulation and an administrator are refused with 403; a teacher of another simulation and a
// malformed id get `not_found`, are logged, and change nothing.
import type { Kysely } from "kysely";
import { afterEach, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { AuthError } from "../middleware.ts";
import type { SimulationResult } from "./access.ts";
import { notFoundLine, type Person, securityLines, type World, world } from "./test-helpers.ts";

/** One teacher write under test. */
export interface TeacherWrite {
  /** Calls the write as `actor` on the world, aimed at the target `target` returns. */
  call: (
    db: Kysely<DB>,
    w: World,
    actor: Person,
    target: string,
  ) => Promise<SimulationResult<unknown>>;
  /** What the write names: the simulation or the lab, and its id in the world. */
  target: (w: World) => { type: "simulation" | "lab"; id: string };
  /** Sets up what the write acts on, before the state is read for comparison. */
  prepare?: (db: Kysely<DB>, w: World) => Promise<void>;
}

/** Everything a write could change, read back to show that a refusal changed nothing. */
async function snapshot(db: Kysely<DB>) {
  const [simulations, teachers, labs, members, emails, removals, audit] = await Promise.all([
    db.selectFrom("simulations").select(["id", "name"]).orderBy("id").execute(),
    db
      .selectFrom("simulation_teachers")
      .select(["simulation_id", "user_id"])
      .orderBy("simulation_id")
      .orderBy("user_id")
      .execute(),
    db.selectFrom("labs").select(["id", "name"]).orderBy("id").execute(),
    db.selectFrom("lab_members").select(["lab_id", "user_id"]).orderBy("user_id").execute(),
    db.selectFrom("lab_member_emails").select(["lab_id", "email"]).orderBy("email").execute(),
    db.selectFrom("simulation_removals").select(["user_id"]).orderBy("user_id").execute(),
    db.selectFrom("audit_event").select("id").orderBy("id").execute(),
  ]);
  return { simulations, teachers, labs, members, emails, removals, audit };
}

/**
 * Adds the negative cases of one teacher write to the current `describe`, each a case of its own:
 * a student of the lab, a student of another lab, a student outside the simulation, an
 * administrator, a teacher of another simulation and a malformed id.
 */
export function teacherWriteRefusals(write: TeacherWrite): void {
  let db: Kysely<DB> | undefined;
  afterEach(async () => {
    await db?.destroy();
    db = undefined;
  });
  async function open() {
    db = await createTestDb();
    const w = await world(db);
    await write.prepare?.(db, w);
    return { db, w };
  }

  const forbidden: [string, (w: World) => Person][] = [
    ["a student of the lab", (w) => w.student],
    ["a student of another lab", (w) => w.otherLabStudent],
    ["a student outside the simulation", (w) => w.outsideStudent],
    ["an administrator", (w) => w.admin],
  ];
  for (const [who, actorOf] of forbidden) {
    it(`refuses ${who} with 403 and changes nothing (R-01)`, async () => {
      const { db: database, w } = await open();
      const before = await snapshot(database);
      const error = await write.call(database, w, actorOf(w), write.target(w).id).then(
        () => null,
        (thrown: unknown) => thrown,
      );
      expect(error).toBeInstanceOf(AuthError);
      expect(error).toMatchObject({ status: 403 });
      expect(await snapshot(database)).toEqual(before);
    });
  }

  it("answers not_found to a teacher of another simulation, logs it, changes nothing (D11)", async () => {
    const { db: database, w } = await open();
    const before = await snapshot(database);
    const target = write.target(w);
    let result: SimulationResult<unknown> | undefined;
    const lines = await securityLines(async () => {
      result = await write.call(database, w, w.outsiderTeacher, target.id);
    });
    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(lines).toEqual([notFoundLine(w.outsiderTeacher.id, target.type, target.id)]);
    expect(await snapshot(database)).toEqual(before);
  });

  it("refuses a malformed id before the query and logs it", async () => {
    const { db: database, w } = await open();
    const before = await snapshot(database);
    const target = write.target(w);
    let result: SimulationResult<unknown> | undefined;
    const lines = await securityLines(async () => {
      result = await write.call(database, w, w.teacher, "not-a-uuid");
    });
    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(lines).toEqual([notFoundLine(w.teacher.id, target.type, "not-a-uuid")]);
    expect(await snapshot(database)).toEqual(before);
  });
}
