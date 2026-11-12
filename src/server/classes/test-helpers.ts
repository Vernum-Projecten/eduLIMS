// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Shared setup of the class service's database tests: fictional @example.test people with an
// app role, and a class with an owner, a co-teacher and students.
import type { Kysely } from "kysely";
import { expect } from "vitest";
import { formatRoles, type Role } from "../../lib/roles.ts";
import { newId } from "../db/ids.ts";
import type { DB } from "../db/schema.gen.ts";
import { setSecurityLogWriter } from "../security-log.ts";
import type { ClassActor } from "./access.ts";
import { createClass } from "./classes.ts";

export const NOW = new Date("2026-11-11T09:00:00Z");

/** Creates a person with `roles` and a verified email and returns them as an actor. */
export async function person(
  db: Kysely<DB>,
  key: string,
  roles: readonly Role[],
  options: { verified?: boolean; name?: string } = {},
): Promise<ClassActor & { email: string }> {
  const id = newId();
  const email = `${key}@example.test`;
  await db
    .insertInto("user")
    .values({
      id,
      name: options.name ?? `Test ${key}`,
      email,
      emailVerified: options.verified ?? true,
      role: formatRoles(roles),
    })
    .execute();
  return { id, roles, email };
}

/** Adds `userId` to a class with a class role, bypassing the service (test setup only). */
export async function join(
  db: Kysely<DB>,
  classId: string,
  userId: string,
  role: "owner" | "teacher" | "student",
): Promise<void> {
  await db
    .insertInto("member")
    .values({ id: newId(), organizationId: classId, userId, role, createdAt: NOW })
    .execute();
}

/** A class with its owner, one co-teacher and two students, and an outsider teacher. */
export async function classWithPeople(db: Kysely<DB>) {
  const owner = await person(db, "owner", ["teacher"]);
  const coTeacher = await person(db, "co-teacher", ["teacher"]);
  const outsider = await person(db, "outsider", ["teacher"]);
  const studentA = await person(db, "student-a", ["student"], { name: "Ada Test" });
  const studentB = await person(db, "student-b", ["student"], { name: "Bo Test" });
  const created = await createClass(db, owner, { name: "LS-2A", academicYear: "2026-2027" }, NOW);
  if (!created.ok) throw new Error(created.error);
  const classId = created.value.classId;
  await join(db, classId, coTeacher.id, "teacher");
  await join(db, classId, studentA.id, "student");
  await join(db, classId, studentB.id, "student");
  return { classId, owner, coTeacher, outsider, studentA, studentB };
}

/** Returns the activity-log rows of an action, oldest first. */
export function auditRows(db: Kysely<DB>, action: string) {
  return db
    .selectFrom("audit_event")
    .select(["actor_id", "outcome", "target_type", "target_id", "reason_code", "metadata"])
    .where("action", "=", action)
    .orderBy("occurred_at")
    .orderBy("id")
    .execute();
}

/** Captures the security stream (stdout) while `run` runs and returns its parsed lines. */
export async function securityLines(
  run: () => Promise<unknown>,
): Promise<Record<string, unknown>[]> {
  const lines: string[] = [];
  const restore = setSecurityLogWriter((line) => lines.push(line));
  try {
    await run();
  } finally {
    restore();
  }
  return lines.map((line): Record<string, unknown> => JSON.parse(line));
}

/** The `authz_fail` line {@link logClassNotFound} writes for `actorId` asking for `classId`. */
export function classNotFoundLine(actorId: string, classId: string) {
  return expect.objectContaining({
    event: "authz_fail",
    level: "warn",
    actor_id: actorId,
    target_type: "class",
    target_id: classId,
    reason: "not_class_teacher",
    status: 404,
  });
}
