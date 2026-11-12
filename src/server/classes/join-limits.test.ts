// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import {
  chargeAttempt,
  JOIN_LIMITS,
  type JoinLimits,
  justOverLimit,
  limitKeyText,
  overLimit,
  refundAttempt,
} from "./join-limits.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function open(): Promise<Kysely<DB>> {
  db = await createTestDb();
  return db;
}

const KEY = "a".repeat(64);
const OTHER = "b".repeat(64);
const WINDOW = 60_000;
const T0 = new Date("2026-11-11T09:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const LIMITS: JoinLimits = { user: 3, ip: 5, windowMs: WINDOW };

describe("chargeAttempt (#49, ASVS V2.4.1)", () => {
  it("counts the attempts of one key in its window", async () => {
    const database = await open();
    expect(await chargeAttempt(database, KEY, at(0), WINDOW)).toBe(1);
    expect(await chargeAttempt(database, KEY, at(1), WINDOW)).toBe(2);
    expect(await chargeAttempt(database, OTHER, at(2), WINDOW)).toBe(1);
    expect(await chargeAttempt(database, KEY, at(3), WINDOW)).toBe(3);
  });

  it("starts a new window once the old one has passed", async () => {
    const database = await open();
    await chargeAttempt(database, KEY, at(0), WINDOW);
    await chargeAttempt(database, KEY, at(1), WINDOW);
    expect(await chargeAttempt(database, KEY, at(WINDOW), WINDOW)).toBe(1);
    expect(await chargeAttempt(database, KEY, at(WINDOW + 1), WINDOW)).toBe(2);
  });

  it("stores the keyed hash only, never the address", async () => {
    const database = await open();
    await chargeAttempt(database, KEY, at(0), WINDOW);
    const rows = await database.selectFrom("class_join_attempts").select("key_hash").execute();
    expect(rows).toEqual([{ key_hash: KEY }]);
    await expect(chargeAttempt(database, "ip:192.0.2.10", at(0), WINDOW)).rejects.toThrow();
  });
});

describe("refundAttempt", () => {
  it("takes back one attempt, never below zero, and only in the current window", async () => {
    const database = await open();
    await chargeAttempt(database, KEY, at(0), WINDOW);
    await refundAttempt(database, KEY, at(1), WINDOW);
    await refundAttempt(database, KEY, at(2), WINDOW);
    expect(await chargeAttempt(database, KEY, at(3), WINDOW)).toBe(1);
    await refundAttempt(database, KEY, at(WINDOW + 10), WINDOW);
    expect(await chargeAttempt(database, KEY, at(4), WINDOW)).toBe(2);
  });
});

describe("the limit of a charge", () => {
  const user = { kind: "user", id: "u1" } as const;
  const ip = { kind: "ip", address: "192.0.2.10" } as const;

  it("is over once the count passes the key's limit, and just over exactly once", () => {
    const charge = (key: typeof user | typeof ip, attempts: number) => ({
      key,
      keyHash: KEY,
      attempts,
    });
    expect(overLimit(charge(user, 3), LIMITS)).toBe(false);
    expect(overLimit(charge(user, 4), LIMITS)).toBe(true);
    expect(justOverLimit(charge(user, 4), LIMITS)).toBe(true);
    expect(justOverLimit(charge(user, 5), LIMITS)).toBe(false);
    expect(overLimit(charge(ip, 5), LIMITS)).toBe(false);
    expect(overLimit(charge(ip, 6), LIMITS)).toBe(true);
  });

  it("keeps a student and an address with the same text apart", () => {
    expect(limitKeyText({ kind: "user", id: "x" })).not.toBe(
      limitKeyText({ kind: "ip", address: "x" }),
    );
  });

  it("allows a lab of students behind one address more wrong codes than one student", () => {
    expect(JOIN_LIMITS.ip).toBeGreaterThan(JOIN_LIMITS.user);
  });
});
