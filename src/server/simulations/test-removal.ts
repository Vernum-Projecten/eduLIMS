// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Shared set-up of the removal tests of #330: the world of test-join.ts with a third lab, a
// waiting row written by hand, the reads of waiting rows, removal records and removed refusals,
// and point 2's sequence (an unverified student joins lab A while their address waits in lab B,
// and a teacher removes them).
import type { Kysely } from "kysely";
import { expect } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { joinLabWithCode } from "./join.ts";
import { removeMember } from "./members.ts";
import { auditRows, NOW, type Person, person } from "./test-helpers.ts";
import { context, emptyLab, worldWithCode } from "./test-join.ts";

/** A day after {@link NOW}: the time of a later sign-in or a second removal. */
export const LATER = new Date(NOW.getTime() + 86_400_000);

/** The address of a classmate who has no account yet, which an impostor claims unverified. */
export const CLASSMATE = "classmate@example.test";

/** Returns the world of test-join.ts with a third lab, on `database`. */
export async function removalWorld(database: Kysely<DB>) {
  const w = await worldWithCode(database);
  const third = await emptyLab(database, w.simulationId, "Third Lab");
  return { database, w: { ...w, third } };
}

/** The world {@link removalWorld} builds. */
export type Opened = Awaited<ReturnType<typeof removalWorld>>;

/** Returns the waiting rows of `email`, ordered by lab. */
export function waiting(database: Kysely<DB>, email: string) {
  return database
    .selectFrom("lab_member_emails")
    .select(["simulation_id", "lab_id"])
    .where("email", "=", email)
    .orderBy("lab_id")
    .execute();
}

/** Lets `email` wait in `labId`, bypassing the service (test set-up only). */
export async function wait(
  database: Kysely<DB>,
  simulationId: string,
  labId: string,
  email: string,
): Promise<void> {
  await database
    .insertInto("lab_member_emails")
    .values({ simulation_id: simulationId, lab_id: labId, email })
    .execute();
}

/** Returns the removal records of the simulation. */
export function removals(database: Kysely<DB>, simulationId: string) {
  return database
    .selectFrom("simulation_removals")
    .select("user_id")
    .where("simulation_id", "=", simulationId)
    .orderBy("user_id")
    .execute();
}

/** Marks the email of `userId` verified. */
export async function verify(database: Kysely<DB>, userId: string): Promise<void> {
  await database
    .updateTable("user")
    .set({ emailVerified: true })
    .where("id", "=", userId)
    .execute();
}

/** Returns the link refusals with the reason `removed`. */
export async function removedRefusals(database: Kysely<DB>) {
  const rows = await auditRows(database, "lab_member_joined");
  return rows.filter((row) => row.reason_code === "removed");
}

/** Removes `userId` from the simulation as the world's teacher at `now`. */
export function remove({ database, w }: Opened, userId: string, now = NOW) {
  return removeMember(database, w.teacher, { simulationId: w.simulationId, userId }, now);
}

/**
 * Point 2 of #330: an unverified account `key` joins lab A with the code while its address waits
 * in lab B, and the teacher removes it.
 */
export async function removedWhileWaiting(opened: Opened, key: string): Promise<Person> {
  const { database, w } = opened;
  const student = await person(database, key, ["student"], { verified: false });
  await wait(database, w.simulationId, w.otherLabId, student.email);
  expect((await joinLabWithCode(database, student, { code: w.code }, context())).ok).toBe(true);
  expect(await remove(opened, student.id)).toEqual({ ok: true, value: null });
  return student;
}
