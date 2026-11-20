// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { type Kysely, sql } from "kysely";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { addEmails } from "./emails.ts";
import { hasWaitingLabAddress, linkWaitingAddresses } from "./linking.ts";
import { auditRows, NOW, person, type World, world } from "./test-helpers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
  vi.restoreAllMocks();
});

async function open(): Promise<{ database: Kysely<DB>; w: World }> {
  db = await createTestDb();
  return { database: db, w: await world(db) };
}

async function placesOf(database: Kysely<DB>, userId: string) {
  const rows = await database
    .selectFrom("lab_members")
    .select(["lab_id", "joined_via"])
    .where("user_id", "=", userId)
    .orderBy("lab_id")
    .execute();
  return rows;
}

describe("linkWaitingAddresses (S10: in the lab without doing anything)", () => {
  it("links a verified student to every lab that waits for their address, logged with ids", async () => {
    const { database, w } = await open();
    const newcomer = await person(database, "newcomer", ["student"]);
    await addEmails(
      database,
      w.teacher,
      { labId: w.otherLabId, emails: ["NEWCOMER@example.test"] },
      NOW,
    );
    await addEmails(
      database,
      w.outsiderTeacher,
      { labId: w.outsideLabId, emails: [newcomer.email] },
      NOW,
    );
    const outcome = await linkWaitingAddresses(database, newcomer.id, NOW);
    expect(outcome).toEqual({ linked: 2, refused: 0, failed: 0 });
    expect(await placesOf(database, newcomer.id)).toEqual(
      [
        { lab_id: w.otherLabId, joined_via: "email" },
        { lab_id: w.outsideLabId, joined_via: "email" },
      ].sort((a, b) => a.lab_id.localeCompare(b.lab_id)),
    );
    const left = await database
      .selectFrom("lab_member_emails")
      .select("email")
      .where("email", "=", newcomer.email)
      .execute();
    expect(left).toEqual([]);
    const rows = await auditRows(database, "lab_member_joined");
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        {
          actor_id: newcomer.id,
          outcome: "success",
          target_type: "lab",
          target_id: w.otherLabId,
          reason_code: null,
          metadata: { simulation_id: w.simulationId, user_id: newcomer.id, join_via: "email" },
        },
      ]),
    );
    expect(JSON.stringify(rows)).not.toContain("@");
  });

  it("links nothing for an unverified address", async () => {
    const { database, w } = await open();
    const unverified = await person(database, "unverified", ["student"], { verified: false });
    await addEmails(database, w.teacher, { labId: w.labId, emails: [unverified.email] }, NOW);
    expect(await linkWaitingAddresses(database, unverified.id, NOW)).toEqual({
      linked: 0,
      refused: 0,
      failed: 0,
    });
    expect(await placesOf(database, unverified.id)).toEqual([]);
  });

  it.each([
    ["a teacher", ["teacher"]],
    ["an administrator", ["admin"]],
    ["a teacher-administrator", ["teacher", "admin"]],
  ] as const)("never puts %s in a lab", async (_who, roles) => {
    const { database, w } = await open();
    const account = await person(database, "not-a-student", roles);
    await addEmails(database, w.teacher, { labId: w.labId, emails: [account.email] }, NOW);
    expect((await linkWaitingAddresses(database, account.id, NOW)).linked).toBe(0);
    expect(await placesOf(database, account.id)).toEqual([]);
  });

  it("keeps a student in their lab and logs the waiting row of another lab as refused", async () => {
    const { database, w } = await open();
    await database
      .insertInto("lab_member_emails")
      .values({ simulation_id: w.simulationId, lab_id: w.otherLabId, email: w.student.email })
      .execute();
    const outcome = await linkWaitingAddresses(database, w.student.id, NOW);
    expect(outcome).toEqual({ linked: 0, refused: 1, failed: 0 });
    expect(await placesOf(database, w.student.id)).toEqual([
      { lab_id: w.labId, joined_via: "email" },
    ]);
    expect(await auditRows(database, "lab_member_joined")).toEqual([
      expect.objectContaining({
        outcome: "refused",
        reason_code: "in_other_lab",
        target_id: w.otherLabId,
      }),
    ]);
  });

  it("drops the refused waiting address, so a second run writes nothing more (S5)", async () => {
    const { database, w } = await open();
    await database
      .insertInto("lab_member_emails")
      .values({ simulation_id: w.simulationId, lab_id: w.otherLabId, email: w.student.email })
      .execute();
    await linkWaitingAddresses(database, w.student.id, NOW);
    const left = await database
      .selectFrom("lab_member_emails")
      .select("email")
      .where("email", "=", w.student.email)
      .execute();
    expect(left).toEqual([]);
    expect(await linkWaitingAddresses(database, w.student.id, NOW)).toEqual({
      linked: 0,
      refused: 0,
      failed: 0,
    });
    expect(await auditRows(database, "lab_member_joined")).toHaveLength(1);
  });

  it("links no address that is not plain ASCII, such as one with a KELVIN SIGN (S4)", async () => {
    const { database, w } = await open();
    const kelvin = await person(database, "kelvin", ["student"]);
    await database
      .updateTable("user")
      .set({ email: "\u212aelvin@example.test" })
      .where("id", "=", kelvin.id)
      .execute();
    await database
      .insertInto("lab_member_emails")
      .values({ simulation_id: w.simulationId, lab_id: w.otherLabId, email: "kelvin@example.test" })
      .execute();
    expect(await linkWaitingAddresses(database, kelvin.id, NOW)).toEqual({
      linked: 0,
      refused: 0,
      failed: 0,
    });
    expect(await placesOf(database, kelvin.id)).toEqual([]);
    expect(await hasWaitingLabAddress(database, "\u212aelvin@example.test")).toBe(false);
  });

  it("links nothing for a verified non-ASCII address such as josé@school.example (#311)", async () => {
    const { database, w } = await open();
    const jose = await person(database, "jose", ["student"], { verified: true });
    await database
      .updateTable("user")
      .set({ email: "josé@school.example" })
      .where("id", "=", jose.id)
      .execute();
    await database
      .insertInto("lab_member_emails")
      .values({ simulation_id: w.simulationId, lab_id: w.otherLabId, email: "josé@school.example" })
      .execute();
    expect(await linkWaitingAddresses(database, jose.id, NOW)).toEqual({
      linked: 0,
      refused: 0,
      failed: 0,
    });
    expect(await placesOf(database, jose.id)).toEqual([]);
    expect(await hasWaitingLabAddress(database, "josé@school.example")).toBe(false);
  });

  it("consumes a waiting row of the lab the student is already in, without a second place", async () => {
    const { database, w } = await open();
    await database
      .insertInto("lab_member_emails")
      .values({ simulation_id: w.simulationId, lab_id: w.labId, email: w.student.email })
      .execute();
    expect((await linkWaitingAddresses(database, w.student.id, NOW)).linked).toBe(1);
    expect(await placesOf(database, w.student.id)).toEqual([
      { lab_id: w.labId, joined_via: "email" },
    ]);
  });

  // NOTE: #330 (maintainer, 2026-11-20); a removal wins over a waiting address, so the link keeps
  // the removal record; only a teacher adding the address again clears it.
  it("refuses a removed student and keeps the removal record and the row (#330)", async () => {
    const { database, w } = await open();
    const back = await person(database, "back", ["student"]);
    await database
      .insertInto("simulation_removals")
      .values({ simulation_id: w.simulationId, user_id: back.id, removed_by: w.teacher.id })
      .execute();
    await database
      .insertInto("lab_member_emails")
      .values({ simulation_id: w.simulationId, lab_id: w.labId, email: back.email })
      .execute();
    expect(await linkWaitingAddresses(database, back.id, NOW)).toEqual({
      linked: 0,
      refused: 1,
      failed: 0,
    });
    const removals = await database
      .selectFrom("simulation_removals")
      .select("user_id")
      .where("user_id", "=", back.id)
      .execute();
    expect(removals).toEqual([{ user_id: back.id }]);
    const waitingRows = await database
      .selectFrom("lab_member_emails")
      .select("lab_id")
      .where("email", "=", back.email)
      .execute();
    expect(waitingRows).toEqual([{ lab_id: w.labId }]);
  });

  it("links row by row: one failed row rolls back alone and is logged with ids", async () => {
    const { database, w } = await open();
    const newcomer = await person(database, "newcomer", ["student"]);
    await addEmails(database, w.teacher, { labId: w.labId, emails: [newcomer.email] }, NOW);
    await addEmails(
      database,
      w.outsiderTeacher,
      { labId: w.outsideLabId, emails: [newcomer.email] },
      NOW,
    );
    // The first simulation's insert fails, as a broken row would.
    await sql`create function test_refuse_place() returns trigger language plpgsql as $$
      begin
        if new.simulation_id = ${sql.lit(w.simulationId)}::uuid then raise exception 'refused'; end if;
        return new;
      end $$`.execute(database);
    await sql`create trigger test_refuse_place before insert on lab_members
      for each row execute function test_refuse_place()`.execute(database);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const outcome = await linkWaitingAddresses(database, newcomer.id, NOW);
    expect(outcome).toEqual({ linked: 1, refused: 0, failed: 1 });
    expect(await placesOf(database, newcomer.id)).toEqual([
      { lab_id: w.outsideLabId, joined_via: "email" },
    ]);
    const stillWaiting = await database
      .selectFrom("lab_member_emails")
      .select("lab_id")
      .where("email", "=", newcomer.email)
      .execute();
    expect(stillWaiting).toEqual([{ lab_id: w.labId }]);
    expect(errors).toHaveBeenCalledWith(
      expect.stringMatching(
        `^lab_link_failed user=${newcomer.id} simulation=${w.simulationId} \\w+$`,
      ),
    );
  });

  it("links nothing for an unknown user", async () => {
    const { database } = await open();
    expect((await linkWaitingAddresses(database, "no-such-user", NOW)).linked).toBe(0);
  });
});

describe("hasWaitingLabAddress (the student grant of the sign-in gate, S10)", () => {
  it("is true only for an address that waits on a lab's list, in any case", async () => {
    const { database, w } = await open();
    await addEmails(
      database,
      w.teacher,
      { labId: w.labId, emails: ["first.timer@example.test"] },
      NOW,
    );
    expect(await hasWaitingLabAddress(database, "First.Timer@example.test")).toBe(true);
    expect(await hasWaitingLabAddress(database, "student-1@example.test")).toBe(false);
    expect(await hasWaitingLabAddress(database, "nobody@example.test")).toBe(false);
  });
});
