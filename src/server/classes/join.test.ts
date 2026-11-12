// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { archiveClass } from "./classes.ts";
import { joinClassWithCode } from "./join.ts";
import { joinCodeKey, regenerateJoinCode } from "./join-code.ts";
import { auditRows, NOW, person, securityLines } from "./test-helpers.ts";
import {
  classWithCode,
  context,
  DAY,
  key,
  LIMITS,
  memberRole,
  usesOf,
  WRONG,
} from "./test-join.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function open(): Promise<Kysely<DB>> {
  db = await createTestDb();
  return db;
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
    expect((await joinClassWithCode(database, other, { code }, context())).ok).toBe(true);
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
    expect(await joinClassWithCode(database, studentA, { code }, context())).toEqual({
      ok: true,
      value: { status: "already_member", className: "LS-2A", academicYear: "2026-2027" },
    });
    expect(await usesOf(database, classId)).toBe(0);
    expect(await auditRows(database, "class_joined")).toEqual([]);
  });

  it("refunds the attempt a join charged, so joins never count against the limit", async () => {
    const database = await open();
    const { code } = await classWithCode(database, { validDays: 7, maxUses: 100 });
    const ctx = context();
    for (let i = 0; i < LIMITS.ip + 2; i += 1) {
      const student = await person(database, `lab-${i}`, ["student"]);
      expect((await joinClassWithCode(database, student, { code }, ctx)).ok).toBe(true);
    }
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
    expect(await joinClassWithCode(database, staff, { code }, context())).toEqual({
      ok: false,
      error: "not_a_student",
    });
    expect(await memberRole(database, classId, staff.id)).toBeNull();
    expect(await auditRows(database, "class_join_failed")).toEqual([
      expect.objectContaining({
        actor_id: staff.id,
        outcome: "refused",
        reason_code: "not_a_student",
      }),
    ]);
  });

  it("answers a wrong code as invalid_code without naming a class or the address", async () => {
    const database = await open();
    await classWithCode(database);
    const guesser = await person(database, "guesser", ["student"]);
    let result: Awaited<ReturnType<typeof joinClassWithCode>> | undefined;
    const lines = await securityLines(async () => {
      result = await joinClassWithCode(database, guesser, { code: WRONG }, context());
    });
    expect(result).toEqual({ ok: false, error: "invalid_code" });
    expect(await auditRows(database, "class_join_failed")).toEqual([
      expect.objectContaining({
        actor_id: guesser.id,
        outcome: "failure",
        reason_code: "unknown_code",
        target_id: null,
      }),
    ]);
    expect(lines).toContainEqual(
      expect.objectContaining({ event: "class_join_failed", reason: "unknown_code" }),
    );
    expect(JSON.stringify(lines)).not.toContain(guesser.email);
    expect(JSON.stringify(lines)).not.toContain("192.0.2.10");
  });

  it.each([
    ["malformed", "nope", "malformed_code"],
    ["of the wrong shape but long", "ZZZZZ-ZZZZZ-ZZ", "malformed_code"],
  ])("answers a %s code as invalid_code and counts it", async (_case, typed, reason) => {
    const database = await open();
    await classWithCode(database);
    const guesser = await person(database, "guesser", ["student"]);
    expect(await joinClassWithCode(database, guesser, { code: typed }, context())).toEqual({
      ok: false,
      error: "invalid_code",
    });
    expect(await auditRows(database, "class_join_failed")).toEqual([
      expect.objectContaining({ reason_code: reason }),
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
      key,
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

  it("does not work under a rotated secret (review L2)", async () => {
    const database = await open();
    const { code } = await classWithCode(database);
    const newcomer = await person(database, "newcomer", ["student"]);
    const rotated = context({ key: joinCodeKey("a-rotated-better-auth-secret-of-enough-length") });
    expect(await joinClassWithCode(database, newcomer, { code }, rotated)).toEqual({
      ok: false,
      error: "invalid_code",
    });
  });
});

describe("joinClassWithCode: the brute-force limit (#49, ASVS V2.4.1)", () => {
  it("refuses a student over their limit, even with the right code, and logs it once", async () => {
    const database = await open();
    const { classId, code } = await classWithCode(database);
    const guesser = await person(database, "guesser", ["student"]);
    const ctx = context({ clientIp: null });
    for (let i = 0; i < LIMITS.user; i += 1) {
      expect(await joinClassWithCode(database, guesser, { code: WRONG }, ctx)).toEqual({
        ok: false,
        error: "invalid_code",
      });
    }
    const lines = await securityLines(async () => {
      for (const typed of [code, WRONG, code]) {
        expect(await joinClassWithCode(database, guesser, { code: typed }, ctx)).toEqual({
          ok: false,
          error: "rate_limited",
        });
      }
    });
    expect(await memberRole(database, classId, guesser.id)).toBeNull();
    // One stream line for the moment the limit was reached, none for the later tries (L3).
    expect(lines).toEqual([
      expect.objectContaining({
        event: "class_join_failed",
        outcome: "refused",
        reason: "rate_limited_user",
      }),
    ]);
    const rows = await auditRows(database, "class_join_failed");
    expect(rows.filter((row) => row.reason_code === "rate_limited_user")).toHaveLength(1);
    expect(rows.filter((row) => row.reason_code === "unknown_code")).toHaveLength(LIMITS.user);
  });

  it("lets a student behind a limited address join with a valid code (owner decision, M3)", async () => {
    const database = await open();
    const { classId, code } = await classWithCode(database);
    const ctx = context();
    for (let i = 0; i < LIMITS.ip + 1; i += 1) {
      const student = await person(database, `guesser-${i}`, ["student"]);
      await joinClassWithCode(database, student, { code: WRONG }, ctx);
    }
    const honest = await person(database, "honest", ["student"]);
    expect(await joinClassWithCode(database, honest, { code: WRONG }, ctx)).toEqual({
      ok: false,
      error: "rate_limited",
    });
    expect((await joinClassWithCode(database, honest, { code }, ctx)).ok).toBe(true);
    expect(await memberRole(database, classId, honest.id)).toBe("student");
    const rows = await auditRows(database, "class_join_failed");
    expect(rows.filter((row) => row.reason_code === "rate_limited_ip")).toHaveLength(1);
  });

  it("logs no crossing for a join from an address at its limit (review F1)", async () => {
    const database = await open();
    const { code, studentA } = await classWithCode(database);
    const ctx = context();
    for (let i = 0; i < LIMITS.ip; i += 1) {
      const guesser = await person(database, `guesser-${i}`, ["student"]);
      expect((await joinClassWithCode(database, guesser, { code: WRONG }, ctx)).ok).toBe(false);
    }
    for (let i = 0; i < 5; i += 1) {
      expect((await joinClassWithCode(database, studentA, { code }, ctx)).ok).toBe(true);
    }
    const crossings = async () =>
      (await auditRows(database, "class_join_failed")).filter(
        (row) => row.reason_code === "rate_limited_ip",
      );
    expect(await crossings()).toHaveLength(0);
    const last = await person(database, "last-guesser", ["student"]);
    expect(await joinClassWithCode(database, last, { code: WRONG }, ctx)).toEqual({
      ok: false,
      error: "rate_limited",
    });
    expect(await crossings()).toHaveLength(1);
  });

  it("counts attempts under a key of its own, never the code's (review F2)", async () => {
    const database = await open();
    await classWithCode(database);
    const guesser = await person(database, "guesser", ["student"]);
    await joinClassWithCode(database, guesser, { code: WRONG }, context({ clientIp: null }));
    const rows = await database.selectFrom("class_join_attempts").select("key_hash").execute();
    expect(rows).toEqual([{ key_hash: key.attemptHash(`user:${guesser.id}`) }]);
    expect(key.attemptHash(`user:${guesser.id}`)).not.toBe(key.hash(`user:${guesser.id}`));
  });

  it("limits per student only when no proxy is trusted", async () => {
    const database = await open();
    const { code } = await classWithCode(database);
    const ctx = context({ clientIp: null });
    for (let i = 0; i < LIMITS.ip + 1; i += 1) {
      const student = await person(database, `anon-${i}`, ["student"]);
      await joinClassWithCode(database, student, { code: WRONG }, ctx);
    }
    const honest = await person(database, "honest", ["student"]);
    expect(await joinClassWithCode(database, honest, { code: WRONG }, ctx)).toEqual({
      ok: false,
      error: "invalid_code",
    });
    expect((await joinClassWithCode(database, honest, { code }, ctx)).ok).toBe(true);
  });

  it("forgets the count once the window has passed", async () => {
    const database = await open();
    const { code } = await classWithCode(database);
    const guesser = await person(database, "guesser", ["student"]);
    for (let i = 0; i <= LIMITS.user; i += 1) {
      await joinClassWithCode(database, guesser, { code: WRONG }, context());
    }
    const later = context({ now: new Date(NOW.getTime() + LIMITS.windowMs) });
    expect((await joinClassWithCode(database, guesser, { code }, later)).ok).toBe(true);
  });
});
