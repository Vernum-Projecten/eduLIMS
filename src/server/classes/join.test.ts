// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { archiveClass } from "./classes.ts";
import { type JoinContext, joinClassWithCode } from "./join.ts";
import { enableJoinCode, joinCodeHasher, regenerateJoinCode } from "./join-code.ts";
import { JoinFailureLimiter, type JoinLimits } from "./join-limits.ts";
import { auditRows, classWithPeople, NOW, person, securityLines } from "./test-helpers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function open(): Promise<Kysely<DB>> {
  db = await createTestDb();
  return db;
}

const hash = joinCodeHasher("join-test-secret-that-is-long-enough-to-use");
const DAY = 86_400_000;
const LIMITS: JoinLimits = {
  user: { maxFailures: 3, windowMs: 60_000 },
  ip: { maxFailures: 5, windowMs: 60_000 },
  maxKeys: 100,
};

function context(overrides: Partial<JoinContext> = {}): JoinContext {
  return {
    now: NOW,
    clientIp: "192.0.2.10",
    hash,
    limiter: new JoinFailureLimiter(LIMITS),
    ...overrides,
  };
}

/** A class with a join code that is on; returns the people and the code. */
async function classWithCode(database: Kysely<DB>, settings = { validDays: 7, maxUses: 30 }) {
  const people = await classWithPeople(database);
  const enabled = await enableJoinCode(
    database,
    people.owner,
    { classId: people.classId, ...settings },
    NOW,
    hash,
  );
  if (!enabled.ok) throw new Error(enabled.error);
  return { ...people, code: enabled.value.code };
}

async function memberRole(database: Kysely<DB>, classId: string, userId: string) {
  const row = await database
    .selectFrom("member")
    .select("role")
    .where("organizationId", "=", classId)
    .where("userId", "=", userId)
    .executeTakeFirst();
  return row?.role ?? null;
}

async function usesOf(database: Kysely<DB>, classId: string) {
  const row = await database
    .selectFrom("class_join_codes")
    .select("uses")
    .where("organization_id", "=", classId)
    .executeTakeFirstOrThrow();
  return row.uses;
}

describe("joinClassWithCode: joining (#49, S2)", () => {
  it("makes the student a class student, counts the use and logs the join", async () => {
    const database = await open();
    const { classId, code } = await classWithCode(database);
    const newcomer = await person(database, "newcomer", ["student"]);
    const result = await joinClassWithCode(database, newcomer, { code }, context());
    expect(result).toEqual({
      ok: true,
      value: { status: "joined", className: "LS-2A", academicYear: "2026-2027" },
    });
    expect(await memberRole(database, classId, newcomer.id)).toBe("student");
    expect(await usesOf(database, classId)).toBe(1);
    expect(await auditRows(database, "class_joined")).toEqual([
      expect.objectContaining({
        actor_id: newcomer.id,
        outcome: "success",
        target_type: "class",
        target_id: classId,
        metadata: { class_role: "student" },
      }),
    ]);
  });

  it("needs no verified email: the code is the proof (owner decision on #28)", async () => {
    const database = await open();
    const { classId, code } = await classWithCode(database);
    const other = await person(database, "other-address", ["student"], { verified: false });
    const result = await joinClassWithCode(database, other, { code }, context());
    expect(result.ok).toBe(true);
    expect(await memberRole(database, classId, other.id)).toBe("student");
  });

  it("takes the code in small letters, with spaces and without its dash", async () => {
    const database = await open();
    const { code } = await classWithCode(database);
    const newcomer = await person(database, "newcomer", ["student"]);
    const typed = ` ${code.replace("-", " ").toLowerCase()} `;
    expect((await joinClassWithCode(database, newcomer, { code: typed }, context())).ok).toBe(true);
  });

  it("tells a member they are in the class already and costs no use", async () => {
    const database = await open();
    const { classId, code, studentA } = await classWithCode(database);
    const result = await joinClassWithCode(database, studentA, { code }, context());
    expect(result).toEqual({
      ok: true,
      value: { status: "already_member", className: "LS-2A", academicYear: "2026-2027" },
    });
    expect(await usesOf(database, classId)).toBe(0);
    expect(await auditRows(database, "class_joined")).toEqual([]);
  });
});

describe("joinClassWithCode: refusals (#49)", () => {
  it.each([
    ["a teacher", ["teacher"]],
    ["an administrator", ["admin"]],
    ["a teacher who is an administrator", ["teacher", "admin"]],
  ] as const)("refuses %s with not_a_student and logs it", async (_who, roles) => {
    const database = await open();
    const { classId, code } = await classWithCode(database);
    const staff = await person(database, "staff", roles);
    const result = await joinClassWithCode(database, staff, { code }, context());
    expect(result).toEqual({ ok: false, error: "not_a_student" });
    expect(await memberRole(database, classId, staff.id)).toBeNull();
    expect(await auditRows(database, "class_join_failed")).toEqual([
      expect.objectContaining({
        actor_id: staff.id,
        outcome: "refused",
        reason_code: "not_a_student",
        target_type: null,
      }),
    ]);
  });

  it("answers a wrong code as invalid_code without naming a class", async () => {
    const database = await open();
    const { code } = await classWithCode(database);
    const guesser = await person(database, "guesser", ["student"]);
    const wrong = code.startsWith("A") ? "BBBBB-BBBBB" : "AAAAA-AAAAA";
    let result: Awaited<ReturnType<typeof joinClassWithCode>> | undefined;
    const lines = await securityLines(async () => {
      result = await joinClassWithCode(database, guesser, { code: wrong }, context());
    });
    expect(result).toEqual({ ok: false, error: "invalid_code" });
    expect(await auditRows(database, "class_join_failed")).toEqual([
      expect.objectContaining({
        actor_id: guesser.id,
        outcome: "failure",
        reason_code: "unknown_code",
        target_type: null,
        target_id: null,
      }),
    ]);
    expect(lines).toContainEqual(
      expect.objectContaining({
        event: "class_join_failed",
        actor_id: guesser.id,
        reason: "unknown_code",
      }),
    );
    expect(JSON.stringify(lines)).not.toContain(guesser.email);
    expect(JSON.stringify(lines)).not.toContain("192.0.2.10");
  });

  it("answers a malformed code as invalid_code and counts it", async () => {
    const database = await open();
    await classWithCode(database);
    const guesser = await person(database, "guesser", ["student"]);
    const result = await joinClassWithCode(database, guesser, { code: "nope" }, context());
    expect(result).toEqual({ ok: false, error: "invalid_code" });
    expect(await auditRows(database, "class_join_failed")).toEqual([
      expect.objectContaining({ reason_code: "malformed_code" }),
    ]);
  });

  it("answers an expired code the same, with the real reason in the log", async () => {
    const database = await open();
    const { classId, code } = await classWithCode(database, { validDays: 1, maxUses: 30 });
    const late = await person(database, "late", ["student"]);
    const ctx = context({ now: new Date(NOW.getTime() + DAY) });
    expect(await joinClassWithCode(database, late, { code }, ctx)).toEqual({
      ok: false,
      error: "invalid_code",
    });
    expect(await memberRole(database, classId, late.id)).toBeNull();
    expect(await auditRows(database, "class_join_failed")).toEqual([
      expect.objectContaining({ reason_code: "code_expired", target_id: classId }),
    ]);
  });

  it("answers a used-up code the same", async () => {
    const database = await open();
    const { classId, code } = await classWithCode(database, { validDays: 7, maxUses: 1 });
    const first = await person(database, "first", ["student"]);
    const second = await person(database, "second", ["student"]);
    expect((await joinClassWithCode(database, first, { code }, context())).ok).toBe(true);
    expect(await joinClassWithCode(database, second, { code }, context())).toEqual({
      ok: false,
      error: "invalid_code",
    });
    expect(await usesOf(database, classId)).toBe(1);
    expect(await auditRows(database, "class_join_failed")).toEqual([
      expect.objectContaining({ reason_code: "code_used_up", target_id: classId }),
    ]);
  });

  it("never works for an archived class", async () => {
    const database = await open();
    const { classId, code, owner } = await classWithCode(database);
    await archiveClass(database, owner, { classId }, NOW);
    const newcomer = await person(database, "newcomer", ["student"]);
    expect(await joinClassWithCode(database, newcomer, { code }, context())).toEqual({
      ok: false,
      error: "invalid_code",
    });
    expect(await memberRole(database, classId, newcomer.id)).toBeNull();
    expect(await auditRows(database, "class_join_failed")).toEqual([
      expect.objectContaining({ reason_code: "class_archived", target_id: classId }),
    ]);
  });

  it("stops the old code once a new one is made", async () => {
    const database = await open();
    const { classId, code, owner } = await classWithCode(database);
    const fresh = await regenerateJoinCode(
      database,
      owner,
      { classId, validDays: 7, maxUses: 30 },
      NOW,
      hash,
    );
    if (!fresh.ok) throw new Error(fresh.error);
    const newcomer = await person(database, "newcomer", ["student"]);
    expect((await joinClassWithCode(database, newcomer, { code }, context())).ok).toBe(false);
    const joined = await joinClassWithCode(
      database,
      newcomer,
      { code: fresh.value.code },
      context(),
    );
    expect(joined.ok).toBe(true);
  });
});

describe("joinClassWithCode: the brute-force limit (#49, ASVS V2.4.1)", () => {
  it("refuses a student after their limit, even with the right code, and logs the moment once", async () => {
    const database = await open();
    const { classId, code } = await classWithCode(database);
    const guesser = await person(database, "guesser", ["student"]);
    const ctx = context();
    for (let i = 0; i < LIMITS.user.maxFailures; i += 1) {
      const wrong = await joinClassWithCode(database, guesser, { code: "AAAAA-AAAA2" }, ctx);
      expect(wrong).toEqual({ ok: false, error: "invalid_code" });
    }
    let blocked: Awaited<ReturnType<typeof joinClassWithCode>> | undefined;
    const lines = await securityLines(async () => {
      blocked = await joinClassWithCode(database, guesser, { code }, ctx);
    });
    expect(blocked).toEqual({ ok: false, error: "rate_limited" });
    expect(await memberRole(database, classId, guesser.id)).toBeNull();
    expect(lines).toEqual([
      expect.objectContaining({
        event: "class_join_failed",
        outcome: "refused",
        actor_id: guesser.id,
        reason: "rate_limited",
      }),
    ]);
    const rows = await auditRows(database, "class_join_failed");
    expect(rows.filter((row) => row.reason_code === "rate_limited")).toHaveLength(1);
    expect(rows.filter((row) => row.reason_code === "unknown_code")).toHaveLength(3);
  });

  it("refuses every student behind an address after the address's limit", async () => {
    const database = await open();
    const { code } = await classWithCode(database);
    const ctx = context();
    for (let i = 0; i < LIMITS.ip.maxFailures; i += 1) {
      const student = await person(database, `guesser-${i}`, ["student"]);
      await joinClassWithCode(database, student, { code: "AAAAA-AAAA2" }, ctx);
    }
    const honest = await person(database, "honest", ["student"]);
    expect(await joinClassWithCode(database, honest, { code }, ctx)).toEqual({
      ok: false,
      error: "rate_limited",
    });
    const elsewhere = await joinClassWithCode(
      database,
      honest,
      { code },
      { ...ctx, clientIp: "192.0.2.99" },
    );
    expect(elsewhere.ok).toBe(true);
  });

  it("does not count successful joins against the address", async () => {
    const database = await open();
    const { code } = await classWithCode(database);
    const ctx = context();
    for (let i = 0; i < LIMITS.ip.maxFailures + 1; i += 1) {
      const student = await person(database, `lab-${i}`, ["student"]);
      expect((await joinClassWithCode(database, student, { code }, ctx)).ok).toBe(true);
    }
  });

  it("limits per student only when no client IP can be trusted", async () => {
    const database = await open();
    const { code } = await classWithCode(database);
    const ctx = context({ clientIp: null });
    for (let i = 0; i < LIMITS.ip.maxFailures; i += 1) {
      const student = await person(database, `anon-${i}`, ["student"]);
      await joinClassWithCode(database, student, { code: "AAAAA-AAAA2" }, ctx);
    }
    const honest = await person(database, "honest", ["student"]);
    expect((await joinClassWithCode(database, honest, { code }, ctx)).ok).toBe(true);
  });
});
