// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Shared set-up of the join-code database tests (#288): one key, small limits, the world of
// test-helpers.ts with a code that is on for its first lab, and reads of a student's place and a
// code's uses.
import type { Kysely } from "kysely";
import type { DB } from "../db/schema.gen.ts";
import type { SimulationActor } from "./access.ts";
import type { JoinContext } from "./join.ts";
import { enableJoinCode, joinCodeKey } from "./join-code.ts";
import type { JoinLimits } from "./join-limits.ts";
import { NOW, world } from "./test-helpers.ts";

export const key = joinCodeKey("join-test-secret-that-is-long-enough-to-use");
export const DAY = 86_400_000;
export const LIMITS: JoinLimits = { user: 3, ip: 5, windowMs: 60_000 };
/** A code of the right shape that no lab has. */
export const WRONG = "AAAAA-AAAA2";
/** The client IP of {@link context}: a documentation address (RFC 5737). */
export const CLIENT_IP = "192.0.2.10";

/** Returns a join context from {@link CLIENT_IP} at {@link NOW}, with `overrides`. */
export function context(overrides: Partial<JoinContext> = {}): JoinContext {
  return { now: NOW, clientIp: CLIENT_IP, key, limits: LIMITS, ...overrides };
}

/** Turns on the code of `labId` as `teacher` and returns it. */
export async function codeOf(
  database: Kysely<DB>,
  teacher: SimulationActor,
  labId: string,
  settings = { validDays: 7, maxUses: 30 },
  codeKey = key,
): Promise<string> {
  const enabled = await enableJoinCode(database, teacher, { labId, ...settings }, NOW, codeKey);
  if (!enabled.ok) throw new Error(enabled.error);
  return enabled.value.code;
}

/** The world of test-helpers.ts with the code of its first lab (`labId`) turned on. */
export async function worldWithCode(
  database: Kysely<DB>,
  settings = { validDays: 7, maxUses: 30 },
) {
  const w = await world(database);
  return { ...w, code: await codeOf(database, w.teacher, w.labId, settings) };
}

/** Returns the lab `userId` is in within the simulation, or `null`. */
export async function labOf(database: Kysely<DB>, simulationId: string, userId: string) {
  const row = await database
    .selectFrom("lab_members")
    .select(["lab_id", "joined_via"])
    .where("simulation_id", "=", simulationId)
    .where("user_id", "=", userId)
    .executeTakeFirst();
  return row ?? null;
}

/** Returns how many students joined with a lab's code. */
export async function usesOf(database: Kysely<DB>, labId: string) {
  const row = await database
    .selectFrom("lab_join_codes")
    .select("uses")
    .where("lab_id", "=", labId)
    .executeTakeFirstOrThrow();
  return row.uses;
}
