// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// One simulation at a time per student (S10, D10, owner 2026-11-20 on #379): every path that puts
// a student in a lab refuses a student in a lab of another prepared or running simulation with
// `in_other_simulation`, logged, and the trigger of migration 0026 holds the rule in the database.
import { type Kysely, sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { addEmails, previewEmails } from "./emails.ts";
import { joinLabWithCode } from "./join.ts";
import { linkWaitingAddresses } from "./linking.ts";
import { moveMember } from "./members.ts";
import { inOtherActiveSimulation } from "./one-simulation.ts";
import { auditRows, NOW, person, place, setState, type World, world } from "./test-helpers.ts";
import { codeOf, context, labOf, usesOf } from "./test-join.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function open(): Promise<{ database: Kysely<DB>; w: World }> {
  db = await createTestDb();
  return { database: db, w: await world(db) };
}

/** The places of `userId` in every simulation, ordered by lab id. */
function placesOf(database: Kysely<DB>, userId: string) {
  return database
    .selectFrom("lab_members")
    .select("lab_id")
    .where("user_id", "=", userId)
    .orderBy("lab_id")
    .execute();
}

describe("the database holds one unfinished simulation per student (#379)", () => {
  it("refuses a second place in another prepared or running simulation", async () => {
    const { database, w } = await open();
    await setState(database, w.outsideSimulationId, "running");
    await expect(
      place(database, w.simulationId, w.labId, w.outsideStudent.id),
    ).rejects.toMatchObject({ code: "23514", constraint: "lab_members_one_active_simulation" });
  });

  it("refuses an update that carries a place into another unfinished simulation", async () => {
    const { database, w } = await open();
    await expect(
      database
        .updateTable("lab_members")
        .set({ simulation_id: w.outsideSimulationId, lab_id: w.outsideLabId })
        .where("user_id", "=", w.student.id)
        .execute(),
    ).rejects.toMatchObject({ constraint: "lab_members_one_active_simulation" });
  });

  it("takes a place once the other simulation is finished", async () => {
    const { database, w } = await open();
    await setState(database, w.outsideSimulationId, "finished");
    await place(database, w.simulationId, w.labId, w.outsideStudent.id);
    expect(await placesOf(database, w.outsideStudent.id)).toHaveLength(2);
  });

  it("takes a place in a finished simulation beside an unfinished one: the rule is about the unfinished", async () => {
    const { database, w } = await open();
    await setState(database, w.simulationId, "finished");
    await place(database, w.simulationId, w.labId, w.outsideStudent.id);
    expect(await placesOf(database, w.outsideStudent.id)).toHaveLength(2);
  });

  it("lets a move inside one simulation pass", async () => {
    const { database, w } = await open();
    await database
      .updateTable("lab_members")
      .set({ lab_id: w.otherLabId })
      .where("user_id", "=", w.student.id)
      .execute();
    expect(await labOf(database, w.simulationId, w.student.id)).toEqual(
      expect.objectContaining({ lab_id: w.otherLabId }),
    );
  });
});

describe("inOtherActiveSimulation (#379)", () => {
  it("sees a place in another unfinished simulation, and none in the asked one", async () => {
    const { database, w } = await open();
    expect(await inOtherActiveSimulation(database, w.outsideStudent.id, w.simulationId)).toBe(true);
    expect(
      await inOtherActiveSimulation(database, w.outsideStudent.id, w.outsideSimulationId),
    ).toBe(false);
    expect(await inOtherActiveSimulation(database, w.stranger.id, w.simulationId)).toBe(false);
  });

  it("ignores a place in a finished simulation", async () => {
    const { database, w } = await open();
    await setState(database, w.outsideSimulationId, "finished");
    expect(await inOtherActiveSimulation(database, w.outsideStudent.id, w.simulationId)).toBe(
      false,
    );
  });
});

describe("a join with a code (#379)", () => {
  it("refuses a student in another prepared simulation with in_other_simulation, logged, free of charge", async () => {
    const { database, w } = await open();
    const code = await codeOf(database, w.teacher, w.labId);
    const result = await joinLabWithCode(database, w.outsideStudent, { code }, context());
    expect(result).toEqual({ ok: false, error: "in_other_simulation" });
    expect(await labOf(database, w.simulationId, w.outsideStudent.id)).toBeNull();
    expect(await usesOf(database, w.labId)).toBe(0);
    expect(await auditRows(database, "lab_join_failed")).toEqual([
      expect.objectContaining({
        actor_id: w.outsideStudent.id,
        outcome: "refused",
        reason_code: "in_other_simulation",
        target_id: w.labId,
      }),
    ]);
    // The refusal costs no attempt, so the limit of three never answers rate_limited here.
    for (let i = 0; i < 4; i += 1) {
      expect(await joinLabWithCode(database, w.outsideStudent, { code }, context())).toEqual({
        ok: false,
        error: "in_other_simulation",
      });
    }
    expect(await auditRows(database, "lab_join_failed")).toHaveLength(1);
  });

  it("refuses a student in another running simulation", async () => {
    const { database, w } = await open();
    await setState(database, w.outsideSimulationId, "running");
    const code = await codeOf(database, w.teacher, w.labId);
    expect(await joinLabWithCode(database, w.outsideStudent, { code }, context())).toEqual({
      ok: false,
      error: "in_other_simulation",
    });
  });

  it("joins a student whose other simulation is finished", async () => {
    const { database, w } = await open();
    await setState(database, w.outsideSimulationId, "finished");
    const code = await codeOf(database, w.teacher, w.labId);
    const result = await joinLabWithCode(database, w.outsideStudent, { code }, context());
    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({ status: "joined", labId: w.labId }),
    });
  });

  it("still tells a member of the lab they are in it (already_member before the rule)", async () => {
    const { database, w } = await open();
    const code = await codeOf(database, w.outsiderTeacher, w.outsideLabId);
    const result = await joinLabWithCode(database, w.outsideStudent, { code }, context());
    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({ status: "already_member" }),
    });
  });
});

describe("the link of a waiting address (#379)", () => {
  it("refuses a student in another unfinished simulation, keeps the address waiting and logs once", async () => {
    const { database, w } = await open();
    // The address of a student in another simulation is refused at the paste, so it is stored
    // here as an address that was added before the student joined the other simulation.
    await database
      .insertInto("lab_member_emails")
      .values({ simulation_id: w.simulationId, lab_id: w.labId, email: w.outsideStudent.email })
      .execute();
    expect(await linkWaitingAddresses(database, w.outsideStudent.id, NOW)).toEqual({
      linked: 0,
      refused: 1,
      failed: 0,
    });
    expect(await linkWaitingAddresses(database, w.outsideStudent.id, NOW)).toEqual({
      linked: 0,
      refused: 1,
      failed: 0,
    });
    expect(await labOf(database, w.simulationId, w.outsideStudent.id)).toBeNull();
    const waiting = await database
      .selectFrom("lab_member_emails")
      .select("lab_id")
      .where("email", "=", w.outsideStudent.email)
      .execute();
    expect(waiting).toEqual([{ lab_id: w.labId }]);
    expect(
      (await auditRows(database, "lab_member_joined")).filter(
        (row) => row.actor_id === w.outsideStudent.id,
      ),
    ).toEqual([
      expect.objectContaining({ outcome: "refused", reason_code: "in_other_simulation" }),
    ]);
  });

  it("links the waiting address once the other simulation is finished", async () => {
    const { database, w } = await open();
    await database
      .insertInto("lab_member_emails")
      .values({ simulation_id: w.simulationId, lab_id: w.labId, email: w.outsideStudent.email })
      .execute();
    await setState(database, w.outsideSimulationId, "finished");
    expect(await linkWaitingAddresses(database, w.outsideStudent.id, NOW)).toEqual({
      linked: 1,
      refused: 0,
      failed: 0,
    });
    expect(await labOf(database, w.simulationId, w.outsideStudent.id)).toEqual(
      expect.objectContaining({ lab_id: w.labId, joined_via: "email" }),
    );
  });

  it("links one of two simulations that wait for a new student and keeps the other waiting", async () => {
    const { database, w } = await open();
    const newcomer = await person(database, "newcomer", ["student"]);
    await addEmails(database, w.teacher, { labId: w.labId, emails: [newcomer.email] }, NOW);
    await addEmails(
      database,
      w.outsiderTeacher,
      { labId: w.outsideLabId, emails: [newcomer.email] },
      NOW,
    );
    expect(await linkWaitingAddresses(database, newcomer.id, NOW)).toEqual({
      linked: 1,
      refused: 1,
      failed: 0,
    });
    expect(await placesOf(database, newcomer.id)).toHaveLength(1);
    const waiting = await database
      .selectFrom("lab_member_emails")
      .select("email")
      .where("email", "=", newcomer.email)
      .execute();
    expect(waiting).toHaveLength(1);
  });
});

describe("a teacher's move (#379)", () => {
  it("refuses to move a student who is in another unfinished simulation, logged, even past the trigger", async () => {
    const { database, w } = await open();
    // Data the trigger would refuse, so the service's own check is what answers here.
    await sql`alter table lab_members disable trigger lab_members_one_active_simulation`.execute(
      database,
    );
    await place(database, w.outsideSimulationId, w.outsideLabId, w.student.id);
    const result = await moveMember(database, w.teacher, {
      simulationId: w.simulationId,
      userId: w.student.id,
      labId: w.otherLabId,
    });
    expect(result).toEqual({ ok: false, error: "in_other_simulation" });
    expect(await labOf(database, w.simulationId, w.student.id)).toEqual(
      expect.objectContaining({ lab_id: w.labId }),
    );
    expect(await auditRows(database, "lab_member_moved")).toEqual([
      expect.objectContaining({
        actor_id: w.teacher.id,
        outcome: "refused",
        reason_code: "in_other_simulation",
        target_id: w.otherLabId,
      }),
    ]);
  });

  it("moves a student who is in no other unfinished simulation", async () => {
    const { database, w } = await open();
    const result = await moveMember(database, w.teacher, {
      simulationId: w.simulationId,
      userId: w.student.id,
      labId: w.otherLabId,
    });
    expect(result).toEqual({ ok: true, value: null });
  });
});

describe("a teacher adding addresses (#379)", () => {
  it("refuses the verified address of a student in another unfinished simulation, at its line, logged", async () => {
    const { database, w } = await open();
    const result = await addEmails(
      database,
      w.teacher,
      { labId: w.labId, emails: [w.outsideStudent.email, "fresh@example.test"] },
      NOW,
    );
    expect(result).toEqual({
      ok: true,
      value: {
        added: 1,
        lines: [
          { email: w.outsideStudent.email, status: "in_other_simulation" },
          { email: "fresh@example.test", status: "new" },
        ],
      },
    });
    const waiting = await database
      .selectFrom("lab_member_emails")
      .select("email")
      .where("simulation_id", "=", w.simulationId)
      .execute();
    expect(waiting).toEqual([{ email: "fresh@example.test" }]);
    expect(await auditRows(database, "lab_emails_added")).toEqual([
      expect.objectContaining({
        outcome: "success",
        metadata: expect.objectContaining({ count: 1 }),
      }),
      expect.objectContaining({
        outcome: "refused",
        reason_code: "in_other_simulation",
        metadata: expect.objectContaining({ count: 1 }),
      }),
    ]);
  });

  it("names no other simulation, lab or teacher on the line", async () => {
    const { database, w } = await open();
    const preview = await previewEmails(database, w.teacher, {
      labId: w.labId,
      emails: [w.outsideStudent.email],
    });
    expect(preview).toEqual({
      ok: true,
      value: [{ email: w.outsideStudent.email, status: "in_other_simulation" }],
    });
  });

  it("takes the address of a student whose other simulation is finished", async () => {
    const { database, w } = await open();
    await setState(database, w.outsideSimulationId, "finished");
    const preview = await previewEmails(database, w.teacher, {
      labId: w.labId,
      emails: [w.outsideStudent.email],
    });
    expect(preview).toEqual({
      ok: true,
      value: [{ email: w.outsideStudent.email, status: "new" }],
    });
  });

  it("takes an address whose account in another simulation is not verified: it never links", async () => {
    const { database, w } = await open();
    await database
      .updateTable("user")
      .set({ emailVerified: false })
      .where("id", "=", w.outsideStudent.id)
      .execute();
    const preview = await previewEmails(database, w.teacher, {
      labId: w.labId,
      emails: [w.outsideStudent.email],
    });
    expect(preview).toEqual({
      ok: true,
      value: [{ email: w.outsideStudent.email, status: "new" }],
    });
  });
});
