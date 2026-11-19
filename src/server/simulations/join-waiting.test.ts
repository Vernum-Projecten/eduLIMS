// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// A place in a lab and a waiting address of the same student never stand side by side (S10, R-01,
// #323): a code join, a removal and a move delete the student's waiting addresses in the
// simulation, so the next link cannot put a removed student back or clear their removal record.
// The counterpart of the deleted class test "cancels the pending invitation in the same
// transaction, so sign-in does not undo it" is the first case below.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { addEmails } from "./emails.ts";
import { joinLabWithCode } from "./join.ts";
import { linkWaitingAddresses } from "./linking.ts";
import { moveMember, removeMember } from "./members.ts";
import { NOW, person, type World } from "./test-helpers.ts";
import { context, labOf, worldWithCode } from "./test-join.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function open() {
  db = await createTestDb();
  const w = await worldWithCode(db);
  return { database: db, w };
}

async function waiting(database: Kysely<DB>, email: string) {
  return database
    .selectFrom("lab_member_emails")
    .select(["simulation_id", "lab_id"])
    .where("email", "=", email)
    .orderBy("lab_id")
    .execute();
}

async function removals(database: Kysely<DB>) {
  return database.selectFrom("simulation_removals").select("user_id").orderBy("user_id").execute();
}

async function addAddress(database: Kysely<DB>, w: World, labId: string, email: string) {
  const added = await addEmails(database, w.teacher, { labId, emails: [email] }, NOW);
  if (!added.ok || added.value.added !== 1) throw new Error("address not added");
}

/** Steps 2 to 4 of #323 for the stranger: join with the code, be removed, sign in. */
async function joinRemoveAndLink(database: Kysely<DB>, w: World & { code: string }) {
  expect(await joinLabWithCode(database, w.stranger, { code: w.code }, context())).toEqual({
    ok: true,
    value: expect.objectContaining({ status: "joined", labId: w.labId }),
  });
  expect(await waiting(database, w.stranger.email)).toEqual([]);
  expect(
    await removeMember(
      database,
      w.teacher,
      { simulationId: w.simulationId, userId: w.stranger.id },
      NOW,
    ),
  ).toEqual({ ok: true, value: null });
  expect(await linkWaitingAddresses(database, w.stranger.id, NOW)).toEqual({
    linked: 0,
    refused: 0,
    failed: 0,
  });
}

describe("a removed student and a waiting address a code join met (#323, R-01)", () => {
  it("stays out after a sign-in when the address waited in the lab joined", async () => {
    const { database, w } = await open();
    await addAddress(database, w, w.labId, w.stranger.email);
    await joinRemoveAndLink(database, w);
    expect(await labOf(database, w.simulationId, w.stranger.id)).toBeNull();
    expect(await removals(database)).toEqual([{ user_id: w.stranger.id }]);
    expect(await joinLabWithCode(database, w.stranger, { code: w.code }, context())).toEqual({
      ok: false,
      error: "invalid_code",
    });
  });

  it("stays out after a sign-in when the address waited in another lab", async () => {
    const { database, w } = await open();
    await addAddress(database, w, w.otherLabId, w.stranger.email);
    await joinRemoveAndLink(database, w);
    expect(await labOf(database, w.simulationId, w.stranger.id)).toBeNull();
    expect(await removals(database)).toEqual([{ user_id: w.stranger.id }]);
    expect(await joinLabWithCode(database, w.stranger, { code: w.code }, context())).toEqual({
      ok: false,
      error: "invalid_code",
    });
  });

  it("comes back once a teacher adds the address again, as before", async () => {
    const { database, w } = await open();
    await addAddress(database, w, w.labId, w.stranger.email);
    await joinRemoveAndLink(database, w);
    await addAddress(database, w, w.otherLabId, w.stranger.email);
    expect(await linkWaitingAddresses(database, w.stranger.id, NOW)).toEqual(
      expect.objectContaining({ linked: 1 }),
    );
    expect(await labOf(database, w.simulationId, w.stranger.id)).toEqual(
      expect.objectContaining({ lab_id: w.otherLabId }),
    );
  });
});

describe("a code join and the student's waiting addresses (#323)", () => {
  it("leaves no address of the student waiting in another lab of the simulation", async () => {
    const { database, w } = await open();
    await addAddress(database, w, w.otherLabId, w.stranger.email);
    expect((await joinLabWithCode(database, w.stranger, { code: w.code }, context())).ok).toBe(
      true,
    );
    expect(await waiting(database, w.stranger.email)).toEqual([]);
    expect(await labOf(database, w.simulationId, w.stranger.id)).toEqual(
      expect.objectContaining({ lab_id: w.labId }),
    );
  });

  it("leaves the student's address waiting in another simulation alone", async () => {
    const { database, w } = await open();
    const added = await addEmails(
      database,
      w.outsiderTeacher,
      { labId: w.outsideLabId, emails: [w.stranger.email] },
      NOW,
    );
    expect(added.ok).toBe(true);
    await joinLabWithCode(database, w.stranger, { code: w.code }, context());
    expect(await waiting(database, w.stranger.email)).toEqual([
      { simulation_id: w.outsideSimulationId, lab_id: w.outsideLabId },
    ]);
  });

  it("deletes nothing for an unverified address, which may not be the student's own", async () => {
    const { database, w } = await open();
    const unverified = await person(database, "unverified", ["student"], { verified: false });
    await addAddress(database, w, w.otherLabId, unverified.email);
    expect((await joinLabWithCode(database, unverified, { code: w.code }, context())).ok).toBe(
      true,
    );
    expect(await waiting(database, unverified.email)).toHaveLength(1);
    await removeMember(
      database,
      w.teacher,
      { simulationId: w.simulationId, userId: unverified.id },
      NOW,
    );
    expect(await waiting(database, unverified.email)).toEqual([]);
  });

  it("costs no waiting address when the code is refused", async () => {
    const { database, w } = await open();
    await addAddress(database, w, w.otherLabId, w.stranger.email);
    await joinLabWithCode(database, w.stranger, { code: "AAAAA-AAAA2" }, context());
    expect(await waiting(database, w.stranger.email)).toHaveLength(1);
  });
});

describe("removing and moving a student delete their waiting addresses (#323)", () => {
  it("removal deletes every address of the student waiting in the simulation, only there", async () => {
    const { database, w } = await open();
    await database
      .insertInto("lab_member_emails")
      .values([
        { simulation_id: w.simulationId, lab_id: w.otherLabId, email: w.student.email },
        { simulation_id: w.outsideSimulationId, lab_id: w.outsideLabId, email: w.student.email },
      ])
      .execute();
    await removeMember(
      database,
      w.teacher,
      { simulationId: w.simulationId, userId: w.student.id },
      NOW,
    );
    expect(await waiting(database, w.student.email)).toEqual([
      { simulation_id: w.outsideSimulationId, lab_id: w.outsideLabId },
    ]);
  });

  it("removal leaves another student's waiting address alone", async () => {
    const { database, w } = await open();
    await addAddress(database, w, w.labId, "waiting@example.test");
    await removeMember(
      database,
      w.teacher,
      { simulationId: w.simulationId, userId: w.student.id },
      NOW,
    );
    expect(await waiting(database, "waiting@example.test")).toHaveLength(1);
  });

  it("a move deletes an address waiting in another lab and keeps one in the target", async () => {
    const { database, w } = await open();
    const third = await database
      .insertInto("labs")
      .values({ simulation_id: w.simulationId, name: "Third Lab" })
      .returning("id")
      .executeTakeFirstOrThrow();
    await database
      .insertInto("lab_member_emails")
      .values([
        { simulation_id: w.simulationId, lab_id: third.id, email: w.student.email },
        { simulation_id: w.outsideSimulationId, lab_id: w.outsideLabId, email: w.student.email },
      ])
      .execute();
    expect(
      await moveMember(database, w.teacher, {
        simulationId: w.simulationId,
        userId: w.student.id,
        labId: w.otherLabId,
      }),
    ).toEqual({ ok: true, value: null });
    expect(await waiting(database, w.student.email)).toEqual([
      { simulation_id: w.outsideSimulationId, lab_id: w.outsideLabId },
    ]);
  });

  it("a move keeps an address that waits in its target lab", async () => {
    const { database, w } = await open();
    await database
      .insertInto("lab_member_emails")
      .values({ simulation_id: w.simulationId, lab_id: w.otherLabId, email: w.student.email })
      .execute();
    await moveMember(database, w.teacher, {
      simulationId: w.simulationId,
      userId: w.student.id,
      labId: w.otherLabId,
    });
    expect(await waiting(database, w.student.email)).toEqual([
      { simulation_id: w.simulationId, lab_id: w.otherLabId },
    ]);
  });
});
