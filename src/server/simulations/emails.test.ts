// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { addEmails, previewEmails, removeEmail } from "./emails.ts";
import { removeMember } from "./members.ts";
import { teacherWriteRefusals } from "./test-access.ts";
import { auditRows, NOW, person, type World, world } from "./test-helpers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function open(): Promise<{ database: Kysely<DB>; w: World }> {
  db = await createTestDb();
  return { database: db, w: await world(db) };
}

async function waiting(database: Kysely<DB>, labId: string) {
  const rows = await database
    .selectFrom("lab_member_emails")
    .select("email")
    .where("lab_id", "=", labId)
    .orderBy("email")
    .execute();
  return rows.map((row) => row.email);
}

describe("previewEmails (D10: the pasted list, per line)", () => {
  it("classifies every line and stores nothing", async () => {
    const { database, w } = await open();
    await database
      .insertInto("lab_member_emails")
      .values([
        { simulation_id: w.simulationId, lab_id: w.labId, email: "waits.here@example.test" },
        { simulation_id: w.simulationId, lab_id: w.otherLabId, email: "waits.there@example.test" },
      ])
      .execute();
    const result = await previewEmails(database, w.teacher, {
      labId: w.labId,
      emails: [
        " New.One@Example.test ",
        "not an address",
        "new.one@example.test",
        "student-2@example.test",
        "waits.here@example.test",
        "other-lab-student@example.test",
        "waits.there@example.test",
        "outside-student@example.test",
      ],
    });
    expect(result).toEqual({
      ok: true,
      value: [
        { email: "new.one@example.test", status: "new" },
        { email: "not an address", status: "invalid" },
        { email: "new.one@example.test", status: "repeated" },
        { email: "student-2@example.test", status: "in_this_lab" },
        { email: "waits.here@example.test", status: "in_this_lab" },
        {
          email: "other-lab-student@example.test",
          status: "in_other_lab",
          otherLab: { id: w.otherLabId, name: "Blue Cuvettes" },
        },
        {
          email: "waits.there@example.test",
          status: "in_other_lab",
          otherLab: { id: w.otherLabId, name: "Blue Cuvettes" },
        },
        // A student of another simulation is new here: nothing tells their account apart.
        { email: "outside-student@example.test", status: "new" },
      ],
    });
    expect(await waiting(database, w.labId)).toEqual(["waits.here@example.test"]);
    expect(await auditRows(database, "lab_emails_added")).toEqual([]);
  });

  it("never tells an address with an account from one without (V8.2.2)", async () => {
    const { database, w } = await open();
    await person(database, "has-account", ["student"]);
    await person(database, "is-a-teacher", ["teacher"]);
    const result = await previewEmails(database, w.teacher, {
      labId: w.labId,
      emails: ["has-account@example.test", "is-a-teacher@example.test", "no-account@example.test"],
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.map((line) => line.status)).toEqual(["new", "new", "new"]);
    expect(JSON.stringify(result.value)).not.toMatch(/Test |name|role/);
  });

  teacherWriteRefusals({
    call: (database, _w, actor, target) =>
      previewEmails(database, actor, { labId: target, emails: ["new@example.test"] }),
    target: (w) => ({ type: "lab", id: w.labId }),
  });
});

describe("addEmails (D10)", () => {
  it("stores only the new lines, once, logged with a count and no address", async () => {
    const { database, w } = await open();
    const result = await addEmails(
      database,
      w.teacher,
      {
        labId: w.otherLabId,
        emails: [
          "a.new@example.test",
          "bad line",
          "a.new@example.test",
          "student-1@example.test",
          "b.new@example.test",
        ],
      },
      NOW,
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.value.added).toBe(2);
    expect(result.value.lines.map((line) => line.status)).toEqual([
      "new",
      "invalid",
      "repeated",
      "in_other_lab",
      "new",
    ]);
    expect(await waiting(database, w.otherLabId)).toEqual([
      "a.new@example.test",
      "b.new@example.test",
    ]);
    const rows = await auditRows(database, "lab_emails_added");
    expect(rows).toEqual([
      {
        actor_id: w.teacher.id,
        outcome: "success",
        target_type: "lab",
        target_id: w.otherLabId,
        reason_code: null,
        metadata: { simulation_id: w.simulationId, count: 2 },
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain("@");
  });

  it("stores nothing from a list of invalid lines", async () => {
    const { database, w } = await open();
    const result = await addEmails(
      database,
      w.teacher,
      { labId: w.labId, emails: ["one", "two@", "@three"] },
      NOW,
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.value.added).toBe(0);
    expect(await waiting(database, w.labId)).toEqual([]);
  });

  it("clears the removal record of a student whose address the teacher adds again", async () => {
    const { database, w } = await open();
    await removeMember(
      database,
      w.teacher,
      { simulationId: w.simulationId, userId: w.student.id },
      NOW,
    );
    await addEmails(database, w.teacher, { labId: w.labId, emails: [w.student.email] }, NOW);
    const removals = await database
      .selectFrom("simulation_removals")
      .select("user_id")
      .where("simulation_id", "=", w.simulationId)
      .execute();
    expect(removals).toEqual([]);
  });

  it("keeps the removal record of an account whose stored address is a KELVIN SIGN look-alike (#311)", async () => {
    const { database, w } = await open();
    const kelvin = await person(database, "kelvin-student", ["student"]);
    await database
      .updateTable("user")
      .set({ email: "Kim@example.test" })
      .where("id", "=", kelvin.id)
      .execute();
    await database
      .insertInto("simulation_removals")
      .values({ simulation_id: w.simulationId, user_id: kelvin.id, removed_by: w.teacher.id })
      .execute();
    await addEmails(database, w.teacher, { labId: w.labId, emails: ["kim@example.test"] }, NOW);
    const removals = await database
      .selectFrom("simulation_removals")
      .select("user_id")
      .where("simulation_id", "=", w.simulationId)
      .execute();
    expect(removals).toEqual([{ user_id: kelvin.id }]);
  });

  it("holds one waiting place per address per simulation in the database too", async () => {
    const { database, w } = await open();
    await addEmails(database, w.teacher, { labId: w.labId, emails: ["x@example.test"] }, NOW);
    await expect(
      database
        .insertInto("lab_member_emails")
        .values({ simulation_id: w.simulationId, lab_id: w.otherLabId, email: "x@example.test" })
        .execute(),
    ).rejects.toThrow(/lab_member_emails_pk/);
  });

  it("refuses an address that is not lower case and trimmed in the database (CHECK)", async () => {
    const { database, w } = await open();
    await expect(
      database
        .insertInto("lab_member_emails")
        .values({ simulation_id: w.simulationId, lab_id: w.labId, email: "Upper@example.test" })
        .execute(),
    ).rejects.toThrow(/lab_member_emails_email/);
  });

  teacherWriteRefusals({
    call: (database, _w, actor, target) =>
      addEmails(database, actor, { labId: target, emails: ["new@example.test"] }, NOW),
    target: (w) => ({ type: "lab", id: w.labId }),
  });
});

describe("removeEmail (#280)", () => {
  it("removes a waiting address of the lab, logged without the address", async () => {
    const { database, w } = await open();
    await addEmails(database, w.teacher, { labId: w.labId, emails: ["gone@example.test"] }, NOW);
    const result = await removeEmail(database, w.teacher, {
      labId: w.labId,
      email: " GONE@example.test ",
    });
    expect(result).toEqual({ ok: true, value: null });
    expect(await waiting(database, w.labId)).toEqual([]);
    const rows = await auditRows(database, "lab_email_removed");
    expect(rows).toEqual([
      expect.objectContaining({
        outcome: "success",
        target_id: w.labId,
        metadata: { simulation_id: w.simulationId },
      }),
    ]);
    expect(JSON.stringify(rows)).not.toContain("@");
  });

  it("answers email_not_found for an address that waits in another lab", async () => {
    const { database, w } = await open();
    await addEmails(
      database,
      w.teacher,
      { labId: w.otherLabId, emails: ["there@example.test"] },
      NOW,
    );
    const result = await removeEmail(database, w.teacher, {
      labId: w.labId,
      email: "there@example.test",
    });
    expect(result).toEqual({ ok: false, error: "email_not_found" });
    expect(await waiting(database, w.otherLabId)).toEqual(["there@example.test"]);
  });

  teacherWriteRefusals({
    prepare: async (database, w) => {
      await database
        .insertInto("lab_member_emails")
        .values({ simulation_id: w.simulationId, lab_id: w.labId, email: "keep@example.test" })
        .execute();
    },
    call: (database, _w, actor, target) =>
      removeEmail(database, actor, { labId: target, email: "keep@example.test" }),
    target: (w) => ({ type: "lab", id: w.labId }),
  });
});
