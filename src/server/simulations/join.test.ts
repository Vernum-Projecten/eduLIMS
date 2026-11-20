// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The student's side of a lab's join code (S10: "a student whose address is unknown joins with
// the lab's code", #288): joining, the identical answer for every wrong code, and the limits.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { joinLabWithCode } from "./join.ts";
import { joinCodeKey, regenerateJoinCode } from "./join-code.ts";
import { deleteLab } from "./labs.ts";
import { auditRows, NOW, person, securityLines, setState } from "./test-helpers.ts";
import {
  CLIENT_IP,
  codeOf,
  context,
  DAY,
  emptyLab,
  key,
  LIMITS,
  labOf,
  usesOf,
  WRONG,
  worldWithCode,
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

describe("joinLabWithCode: joining (S10, #288)", () => {
  it("puts the student in the code's lab, counts the use and logs the join", async () => {
    const database = await open();
    const w = await worldWithCode(database);
    const result = await joinLabWithCode(database, w.stranger, { code: w.code }, context());
    expect(result).toEqual({
      ok: true,
      value: {
        status: "joined",
        labId: w.labId,
        labName: "Pipette Pilots",
        simulationId: w.simulationId,
        simulationName: "Practice simulation",
      },
    });
    expect(await labOf(database, w.simulationId, w.stranger.id)).toEqual({
      lab_id: w.labId,
      joined_via: "code",
    });
    expect(await usesOf(database, w.labId)).toBe(1);
    expect(await auditRows(database, "lab_member_joined")).toEqual([
      {
        actor_id: w.stranger.id,
        outcome: "success",
        target_type: "lab",
        target_id: w.labId,
        reason_code: null,
        metadata: { simulation_id: w.simulationId, user_id: w.stranger.id, join_via: "code" },
      },
    ]);
  });

  it("puts the student in that lab only, never in another lab of the simulation", async () => {
    const database = await open();
    const w = await worldWithCode(database);
    await codeOf(database, w.teacher, w.otherLabId);
    await joinLabWithCode(database, w.stranger, { code: w.code }, context());
    const places = await database
      .selectFrom("lab_members")
      .select("lab_id")
      .where("user_id", "=", w.stranger.id)
      .execute();
    expect(places).toEqual([{ lab_id: w.labId }]);
  });

  it("lets a student whose other simulation is finished join this one too (S10, #379)", async () => {
    const database = await open();
    const w = await worldWithCode(database);
    await setState(database, w.outsideSimulationId, "finished");
    const result = await joinLabWithCode(database, w.outsideStudent, { code: w.code }, context());
    expect(result.ok).toBe(true);
    expect(await labOf(database, w.simulationId, w.outsideStudent.id)).toEqual(
      expect.objectContaining({ lab_id: w.labId }),
    );
    expect(await labOf(database, w.outsideSimulationId, w.outsideStudent.id)).toEqual(
      expect.objectContaining({ lab_id: w.outsideLabId }),
    );
  });

  it("needs no verified email: the code is the proof", async () => {
    const database = await open();
    const w = await worldWithCode(database);
    const other = await person(database, "other-address", ["student"], { verified: false });
    expect((await joinLabWithCode(database, other, { code: w.code }, context())).ok).toBe(true);
    expect(await labOf(database, w.simulationId, other.id)).not.toBeNull();
  });

  it("takes the code in small letters, with spaces and without its dash", async () => {
    const database = await open();
    const w = await worldWithCode(database);
    const typed = ` ${w.code.replace("-", " ").toLowerCase()} `;
    expect((await joinLabWithCode(database, w.stranger, { code: typed }, context())).ok).toBe(true);
  });

  it("tells a member they are in the lab already and costs no use", async () => {
    const database = await open();
    const w = await worldWithCode(database);
    expect(await joinLabWithCode(database, w.student, { code: w.code }, context())).toEqual({
      ok: true,
      value: expect.objectContaining({ status: "already_member", labId: w.labId }),
    });
    expect(await usesOf(database, w.labId)).toBe(0);
    expect(await auditRows(database, "lab_member_joined")).toEqual([]);
  });

  it("refunds the attempt a join charged, so joins never count against the limit", async () => {
    const database = await open();
    const w = await worldWithCode(database, { validDays: 7, maxUses: 100 });
    const ctx = context();
    for (let i = 0; i < LIMITS.ip + 2; i += 1) {
      const student = await person(database, `joiner-${i}`, ["student"]);
      expect((await joinLabWithCode(database, student, { code: w.code }, ctx)).ok).toBe(true);
    }
  });
});

describe("joinLabWithCode: a student in another lab of the simulation (S10, #288)", () => {
  it("refuses with in_other_lab, keeps their place, costs no use and logs it", async () => {
    const database = await open();
    const w = await worldWithCode(database);
    const result = await joinLabWithCode(database, w.otherLabStudent, { code: w.code }, context());
    expect(result).toEqual({ ok: false, error: "in_other_lab" });
    expect(await labOf(database, w.simulationId, w.otherLabStudent.id)).toEqual(
      expect.objectContaining({ lab_id: w.otherLabId }),
    );
    expect(await usesOf(database, w.labId)).toBe(0);
    expect(await auditRows(database, "lab_join_failed")).toEqual([
      {
        actor_id: w.otherLabStudent.id,
        outcome: "refused",
        target_type: "lab",
        target_id: w.labId,
        reason_code: "in_other_lab",
        metadata: { simulation_id: w.simulationId },
      },
    ]);
  });

  it("refunds the attempt, so a refusal never counts against the limit", async () => {
    const database = await open();
    const w = await worldWithCode(database);
    const ctx = context();
    for (let i = 0; i < LIMITS.user + 2; i += 1) {
      expect(await joinLabWithCode(database, w.otherLabStudent, { code: w.code }, ctx)).toEqual({
        ok: false,
        error: "in_other_lab",
      });
    }
    const counts = await database
      .selectFrom("lab_join_attempts")
      .select("failures")
      .where("key_hash", "in", [
        key.attemptHash(`user:${w.otherLabStudent.id}`),
        key.attemptHash(`ip:${CLIENT_IP}`),
      ])
      .execute();
    expect(counts.map((row) => row.failures)).toEqual([0, 0]);
  });

  it("writes one activity-log row for twice the per-student limit of attempts (#323)", async () => {
    const database = await open();
    const w = await worldWithCode(database);
    for (let i = 0; i < 2 * LIMITS.user; i += 1) {
      expect(
        await joinLabWithCode(database, w.otherLabStudent, { code: w.code }, context()),
      ).toEqual({ ok: false, error: "in_other_lab" });
    }
    expect(await auditRows(database, "lab_join_failed")).toEqual([
      expect.objectContaining({ actor_id: w.otherLabStudent.id, reason_code: "in_other_lab" }),
    ]);
  });

  it("writes the row again in a new window, and once per lab (#323)", async () => {
    const database = await open();
    const w = await worldWithCode(database);
    const third = await emptyLab(database, w.simulationId, "Third Lab");
    const thirdCode = await codeOf(database, w.teacher, third);
    const later = context({ now: new Date(NOW.getTime() + LIMITS.windowMs) });
    for (const [code, ctx] of [
      [w.code, context()],
      [w.code, context()],
      [thirdCode, context()],
      [w.code, later],
    ] as const) {
      await joinLabWithCode(database, w.otherLabStudent, { code }, ctx);
    }
    const rows = await auditRows(database, "lab_join_failed");
    expect(rows.map((row) => row.target_id)).toEqual([w.labId, third, w.labId]);
  });
});

describe("joinLabWithCode: refusals (#288)", () => {
  it.each([
    ["a teacher of the simulation", ["teacher"]],
    ["an administrator", ["admin"]],
    ["a teacher who is an administrator", ["teacher", "admin"]],
  ] as const)("refuses %s with not_a_student and logs it", async (_who, roles) => {
    const database = await open();
    const w = await worldWithCode(database);
    const staff = await person(database, "staff", roles);
    expect(await joinLabWithCode(database, staff, { code: w.code }, context())).toEqual({
      ok: false,
      error: "not_a_student",
    });
    expect(await labOf(database, w.simulationId, staff.id)).toBeNull();
    expect(await auditRows(database, "lab_join_failed")).toEqual([
      {
        actor_id: staff.id,
        outcome: "refused",
        target_type: null,
        target_id: null,
        reason_code: "not_a_student",
        metadata: null,
      },
    ]);
  });

  it("refuses a session with no role at all", async () => {
    const database = await open();
    const w = await worldWithCode(database);
    const nobody = { id: w.stranger.id, roles: [] };
    expect(await joinLabWithCode(database, nobody, { code: w.code }, context())).toEqual({
      ok: false,
      error: "not_a_student",
    });
  });

  it("answers a wrong code as invalid_code without naming a lab, the address or the IP", async () => {
    const database = await open();
    const w = await worldWithCode(database);
    let result: Awaited<ReturnType<typeof joinLabWithCode>> | undefined;
    const lines = await securityLines(async () => {
      result = await joinLabWithCode(database, w.stranger, { code: WRONG }, context());
    });
    expect(result).toEqual({ ok: false, error: "invalid_code" });
    expect(await auditRows(database, "lab_join_failed")).toEqual([
      {
        actor_id: w.stranger.id,
        outcome: "failure",
        target_type: null,
        target_id: null,
        reason_code: "unknown_code",
        metadata: null,
      },
    ]);
    expect(lines).toContainEqual(
      expect.objectContaining({ event: "lab_join_failed", reason: "unknown_code" }),
    );
    expect(JSON.stringify(lines)).not.toContain(w.stranger.email);
    expect(JSON.stringify(lines)).not.toContain(CLIENT_IP);
  });

  it.each([
    ["malformed", "nope"],
    ["of the wrong shape but long", "ZZZZZ-ZZZZZ-ZZ"],
  ])("answers a %s code as invalid_code and counts it", async (_case, typed) => {
    const database = await open();
    const w = await worldWithCode(database);
    expect(await joinLabWithCode(database, w.stranger, { code: typed }, context())).toEqual({
      ok: false,
      error: "invalid_code",
    });
    expect(await auditRows(database, "lab_join_failed")).toEqual([
      expect.objectContaining({ reason_code: "malformed_code" }),
    ]);
  });

  it("answers an expired code the same, with the real reason in the log", async () => {
    const database = await open();
    const w = await worldWithCode(database, { validDays: 1, maxUses: 30 });
    const ctx = context({ now: new Date(NOW.getTime() + DAY) });
    expect(await joinLabWithCode(database, w.stranger, { code: w.code }, ctx)).toEqual({
      ok: false,
      error: "invalid_code",
    });
    expect(await auditRows(database, "lab_join_failed")).toEqual([
      expect.objectContaining({ reason_code: "code_expired", target_id: w.labId }),
    ]);
  });

  it("answers a used-up code the same", async () => {
    const database = await open();
    const w = await worldWithCode(database, { validDays: 7, maxUses: 1 });
    const second = await person(database, "second", ["student"]);
    expect((await joinLabWithCode(database, w.stranger, { code: w.code }, context())).ok).toBe(
      true,
    );
    expect(await joinLabWithCode(database, second, { code: w.code }, context())).toEqual({
      ok: false,
      error: "invalid_code",
    });
    expect(await usesOf(database, w.labId)).toBe(1);
    expect(await auditRows(database, "lab_join_failed")).toEqual([
      expect.objectContaining({ reason_code: "code_used_up", target_id: w.labId }),
    ]);
  });

  it("never works for a deleted lab (the archived case of the class code)", async () => {
    const database = await open();
    const w = await worldWithCode(database);
    const created = await database
      .insertInto("labs")
      .values({ simulation_id: w.simulationId, name: "Short-lived Lab" })
      .returning("id")
      .executeTakeFirstOrThrow();
    const code = await codeOf(database, w.teacher, created.id);
    expect((await deleteLab(database, w.teacher, { labId: created.id })).ok).toBe(true);
    expect(await joinLabWithCode(database, w.stranger, { code }, context())).toEqual({
      ok: false,
      error: "invalid_code",
    });
    expect(await labOf(database, w.simulationId, w.stranger.id)).toBeNull();
    expect(await auditRows(database, "lab_join_failed")).toEqual([
      expect.objectContaining({ reason_code: "unknown_code" }),
    ]);
  });

  it("stops the old code once a new one is made", async () => {
    const database = await open();
    const w = await worldWithCode(database);
    const fresh = await regenerateJoinCode(
      database,
      w.teacher,
      { labId: w.labId, validDays: 7, maxUses: 30 },
      NOW,
      key,
    );
    if (!fresh.ok) throw new Error(fresh.error);
    expect((await joinLabWithCode(database, w.stranger, { code: w.code }, context())).ok).toBe(
      false,
    );
    const joined = await joinLabWithCode(
      database,
      w.stranger,
      { code: fresh.value.code },
      context(),
    );
    expect(joined.ok).toBe(true);
  });

  it("does not work under a rotated secret (review L2)", async () => {
    const database = await open();
    const w = await worldWithCode(database);
    const rotated = context({ key: joinCodeKey("a-rotated-better-auth-secret-of-enough-length") });
    expect(await joinLabWithCode(database, w.stranger, { code: w.code }, rotated)).toEqual({
      ok: false,
      error: "invalid_code",
    });
  });
});

describe("joinLabWithCode: the brute-force limit (#288, ASVS V2.4.1)", () => {
  it("refuses a student over their limit, even with the right code, and logs it once", async () => {
    const database = await open();
    const w = await worldWithCode(database);
    const ctx = context({ clientIp: null });
    for (let i = 0; i < LIMITS.user; i += 1) {
      expect(await joinLabWithCode(database, w.stranger, { code: WRONG }, ctx)).toEqual({
        ok: false,
        error: "invalid_code",
      });
    }
    const lines = await securityLines(async () => {
      for (const typed of [w.code, WRONG, w.code]) {
        expect(await joinLabWithCode(database, w.stranger, { code: typed }, ctx)).toEqual({
          ok: false,
          error: "rate_limited",
        });
      }
    });
    expect(await labOf(database, w.simulationId, w.stranger.id)).toBeNull();
    // One stream line for the moment the limit was reached, none for the later tries (L3).
    expect(lines).toEqual([
      expect.objectContaining({
        event: "lab_join_failed",
        outcome: "refused",
        reason: "rate_limited_user",
      }),
    ]);
    const rows = await auditRows(database, "lab_join_failed");
    expect(rows.filter((row) => row.reason_code === "rate_limited_user")).toHaveLength(1);
    expect(rows.filter((row) => row.reason_code === "unknown_code")).toHaveLength(LIMITS.user);
  });

  it("lets a student behind a limited address join with a valid code (owner decision, M3)", async () => {
    const database = await open();
    const w = await worldWithCode(database);
    const ctx = context();
    for (let i = 0; i < LIMITS.ip + 1; i += 1) {
      const student = await person(database, `guesser-${i}`, ["student"]);
      await joinLabWithCode(database, student, { code: WRONG }, ctx);
    }
    expect(await joinLabWithCode(database, w.stranger, { code: WRONG }, ctx)).toEqual({
      ok: false,
      error: "rate_limited",
    });
    expect((await joinLabWithCode(database, w.stranger, { code: w.code }, ctx)).ok).toBe(true);
    expect(await labOf(database, w.simulationId, w.stranger.id)).not.toBeNull();
    const rows = await auditRows(database, "lab_join_failed");
    expect(rows.filter((row) => row.reason_code === "rate_limited_ip")).toHaveLength(1);
  });

  it("still logs a refused crossing after an in_other_lab refund from the same address (#323)", async () => {
    const database = await open();
    const w = await worldWithCode(database);
    const ctx = context();
    for (let i = 0; i < LIMITS.ip; i += 1) {
      const guesser = await person(database, `guesser-${i}`, ["student"]);
      expect((await joinLabWithCode(database, guesser, { code: WRONG }, ctx)).ok).toBe(false);
    }
    expect(await joinLabWithCode(database, w.otherLabStudent, { code: w.code }, ctx)).toEqual({
      ok: false,
      error: "in_other_lab",
    });
    const crossings = async () =>
      (await auditRows(database, "lab_join_failed")).filter(
        (row) => row.reason_code === "rate_limited_ip",
      );
    expect(await crossings()).toHaveLength(0);
    const last = await person(database, "last-guesser", ["student"]);
    expect(await joinLabWithCode(database, last, { code: WRONG }, ctx)).toEqual({
      ok: false,
      error: "rate_limited",
    });
    expect(await crossings()).toEqual([
      expect.objectContaining({ actor_id: last.id, outcome: "refused" }),
    ]);
  });

  it("logs no crossing for a join from an address at its limit (review F1)", async () => {
    const database = await open();
    const w = await worldWithCode(database);
    const ctx = context();
    for (let i = 0; i < LIMITS.ip; i += 1) {
      const guesser = await person(database, `guesser-${i}`, ["student"]);
      expect((await joinLabWithCode(database, guesser, { code: WRONG }, ctx)).ok).toBe(false);
    }
    for (let i = 0; i < 5; i += 1) {
      expect((await joinLabWithCode(database, w.student, { code: w.code }, ctx)).ok).toBe(true);
    }
    const crossings = async () =>
      (await auditRows(database, "lab_join_failed")).filter(
        (row) => row.reason_code === "rate_limited_ip",
      );
    expect(await crossings()).toHaveLength(0);
    const last = await person(database, "last-guesser", ["student"]);
    expect(await joinLabWithCode(database, last, { code: WRONG }, ctx)).toEqual({
      ok: false,
      error: "rate_limited",
    });
    expect(await crossings()).toHaveLength(1);
  });

  it("counts attempts under a key of its own, never the code's (review F2)", async () => {
    const database = await open();
    const w = await worldWithCode(database);
    await joinLabWithCode(database, w.stranger, { code: WRONG }, context({ clientIp: null }));
    const rows = await database.selectFrom("lab_join_attempts").select("key_hash").execute();
    expect(rows).toEqual([{ key_hash: key.attemptHash(`user:${w.stranger.id}`) }]);
    expect(key.attemptHash(`user:${w.stranger.id}`)).not.toBe(key.hash(`user:${w.stranger.id}`));
  });

  it("charges the client IP only as its keyed hash, never the address", async () => {
    const database = await open();
    const w = await worldWithCode(database);
    await joinLabWithCode(database, w.stranger, { code: WRONG }, context());
    const rows = await database
      .selectFrom("lab_join_attempts")
      .select("key_hash")
      .orderBy("key_hash")
      .execute();
    expect(rows.map((row) => row.key_hash).sort()).toEqual(
      [key.attemptHash(`user:${w.stranger.id}`), key.attemptHash(`ip:${CLIENT_IP}`)].sort(),
    );
    expect(JSON.stringify(rows)).not.toContain(CLIENT_IP);
  });

  it("limits per student only when no proxy is trusted", async () => {
    const database = await open();
    const w = await worldWithCode(database);
    const ctx = context({ clientIp: null });
    for (let i = 0; i < LIMITS.ip + 1; i += 1) {
      const student = await person(database, `anon-${i}`, ["student"]);
      await joinLabWithCode(database, student, { code: WRONG }, ctx);
    }
    expect(await joinLabWithCode(database, w.stranger, { code: WRONG }, ctx)).toEqual({
      ok: false,
      error: "invalid_code",
    });
    expect((await joinLabWithCode(database, w.stranger, { code: w.code }, ctx)).ok).toBe(true);
  });

  it("forgets the count once the window has passed", async () => {
    const database = await open();
    const w = await worldWithCode(database);
    for (let i = 0; i <= LIMITS.user; i += 1) {
      await joinLabWithCode(database, w.stranger, { code: WRONG }, context());
    }
    const later = context({ now: new Date(NOW.getTime() + LIMITS.windowMs) });
    expect((await joinLabWithCode(database, w.stranger, { code: w.code }, later)).ok).toBe(true);
  });
});
