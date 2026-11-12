// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Shared setup of the join-code database tests (#49): one key, small limits, a class with a code
// that is on, and reads of a member's role and a code's uses.
import type { Kysely } from "kysely";
import type { DB } from "../db/schema.gen.ts";
import type { JoinContext } from "./join.ts";
import { enableJoinCode, joinCodeKey } from "./join-code.ts";
import type { JoinLimits } from "./join-limits.ts";
import { classWithPeople, NOW } from "./test-helpers.ts";

export const key = joinCodeKey("join-test-secret-that-is-long-enough-to-use");
export const DAY = 86_400_000;
export const LIMITS: JoinLimits = { user: 3, ip: 5, windowMs: 60_000 };
/** A code of the right shape that no class has. */
export const WRONG = "AAAAA-AAAA2";

/** Returns a join context from 192.0.2.10 at {@link NOW}, with `overrides`. */
export function context(overrides: Partial<JoinContext> = {}): JoinContext {
  return { now: NOW, clientIp: "192.0.2.10", key, limits: LIMITS, ...overrides };
}

/** A class with a join code that is on; returns the people and the code. */
export async function classWithCode(
  database: Kysely<DB>,
  settings = { validDays: 7, maxUses: 30 },
) {
  const people = await classWithPeople(database);
  const enabled = await enableJoinCode(
    database,
    people.owner,
    { classId: people.classId, ...settings },
    NOW,
    key,
  );
  if (!enabled.ok) throw new Error(enabled.error);
  return { ...people, code: enabled.value.code };
}

/** Returns the class role of `userId`, or `null` when they are not in the class. */
export async function memberRole(database: Kysely<DB>, classId: string, userId: string) {
  const row = await database
    .selectFrom("member")
    .select("role")
    .where("organizationId", "=", classId)
    .where("userId", "=", userId)
    .executeTakeFirst();
  return row?.role ?? null;
}

/** Returns how many students joined with the class's code. */
export async function usesOf(database: Kysely<DB>, classId: string) {
  const row = await database
    .selectFrom("class_join_codes")
    .select("uses")
    .where("organization_id", "=", classId)
    .executeTakeFirstOrThrow();
  return row.uses;
}
