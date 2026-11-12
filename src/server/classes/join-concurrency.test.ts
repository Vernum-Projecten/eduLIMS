// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Joining with a code under concurrency (#49, security review of #119: H1, L1): parallel wrong
// codes, parallel joins against the limit of uses, and a join that meets an archive or a new code.
// These need real, committing transactions, so each test has a database of its own.
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { type CommittedTestDb, createCommittedTestDb } from "../db/test-committed-db.ts";
import { type JoinContext, joinClassWithCode } from "./join.ts";
import { enableJoinCode, joinCodeKey } from "./join-code.ts";
import { JOIN_LIMITS } from "./join-limits.ts";
import { auditRows, classWithPeople, NOW, person } from "./test-helpers.ts";

const key = joinCodeKey("join-concurrency-test-secret-long-enough");
const WRONG = "AAAAA-AAAA2";
const context: JoinContext = { now: NOW, clientIp: null, key, limits: JOIN_LIMITS };

let committed: CommittedTestDb | undefined;

beforeEach(async () => {
  committed = await createCommittedTestDb();
}, 60_000);

afterEach(async () => {
  await committed?.destroy();
  committed = undefined;
}, 60_000);

function database(): CommittedTestDb {
  if (!committed) throw new Error("no committed test database");
  return committed;
}

async function classWithCode(db: Kysely<DB>, maxUses = 30) {
  const people = await classWithPeople(db);
  const enabled = await enableJoinCode(
    db,
    people.owner,
    { classId: people.classId, validDays: 7, maxUses },
    NOW,
    key,
  );
  if (!enabled.ok) throw new Error(enabled.error);
  return { ...people, code: enabled.value.code };
}

/** Resolves to whether `promise` settles within `ms`. */
async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  const timeout = new Promise<false>((resolve) => setTimeout(() => resolve(false), ms));
  return Promise.race([promise.then(() => true), timeout]);
}

describe("joining with a code in parallel (#49, review H1)", () => {
  it("answers 50 parallel wrong codes of one student with exactly 10 invalid_code", async () => {
    const { db } = database();
    await classWithCode(db);
    const guesser = await person(db, "guesser", ["student"]);
    const results = await Promise.all(
      Array.from({ length: 50 }, () => joinClassWithCode(db, guesser, { code: WRONG }, context)),
    );
    const errors = results.map((result) => (result.ok ? "ok" : result.error));
    expect(errors.filter((error) => error === "invalid_code")).toHaveLength(JOIN_LIMITS.user);
    expect(errors.filter((error) => error === "rate_limited")).toHaveLength(50 - JOIN_LIMITS.user);
    const rows = (await auditRows(db, "class_join_failed")).filter(
      (row) => row.actor_id === guesser.id,
    );
    expect(rows.length).toBeLessThanOrEqual(JOIN_LIMITS.user + 1);
  });

  it("never lets more students join than the code allows", async () => {
    const { db } = database();
    const { classId, code } = await classWithCode(db, 3);
    const students = await Promise.all(
      Array.from({ length: 12 }, (_, i) => person(db, `racer-${i}`, ["student"])),
    );
    const results = await Promise.all(
      students.map((student) => joinClassWithCode(db, student, { code }, context)),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(3);
    const row = await db
      .selectFrom("class_join_codes")
      .select("uses")
      .where("organization_id", "=", classId)
      .executeTakeFirstOrThrow();
    expect(row.uses).toBe(3);
    const joined = await db
      .selectFrom("member")
      .select("userId")
      .where("organizationId", "=", classId)
      .where(
        "userId",
        "in",
        students.map((student) => student.id),
      )
      .execute();
    expect(joined).toHaveLength(3);
  });
});

describe("a join meeting another class write (#49, review L1)", () => {
  it("waits for an archive and then refuses the archived class", async () => {
    const { db, pool } = database();
    const { classId, code } = await classWithCode(db);
    const newcomer = await person(db, "newcomer", ["student"]);
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query('select id from "organization" where id = $1 for update', [classId]);
      await client.query('update "organization" set archived_at = now() where id = $1', [classId]);
      const join = joinClassWithCode(db, newcomer, { code }, context);
      expect(await settlesWithin(join, 300)).toBe(false);
      await client.query("commit");
      expect(await join).toEqual({ ok: false, error: "invalid_code" });
    } finally {
      client.release();
    }
    const rows = await auditRows(db, "class_join_failed");
    expect(rows).toEqual([expect.objectContaining({ reason_code: "class_archived" })]);
  });

  it("waits for a new code and then refuses the old one", async () => {
    const { db, pool } = database();
    const { classId, code } = await classWithCode(db);
    const newcomer = await person(db, "newcomer", ["student"]);
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query('select id from "organization" where id = $1 for update', [classId]);
      await client.query("update class_join_codes set code_hash = $1 where organization_id = $2", [
        key.hash("NEWCODE234"),
        classId,
      ]);
      const join = joinClassWithCode(db, newcomer, { code }, context);
      expect(await settlesWithin(join, 300)).toBe(false);
      await client.query("commit");
      expect(await join).toEqual({ ok: false, error: "invalid_code" });
    } finally {
      client.release();
    }
    const member = await db
      .selectFrom("member")
      .select("userId")
      .where("organizationId", "=", classId)
      .where("userId", "=", newcomer.id)
      .executeTakeFirst();
    expect(member).toBeUndefined();
    const rows = await auditRows(db, "class_join_failed");
    expect(rows).toEqual([expect.objectContaining({ reason_code: "unknown_code" })]);
  });

  it("never deadlocks with a writer that locks the code row before the class (review F3)", async () => {
    const { db, pool } = database();
    const { classId, code } = await classWithCode(db);
    const newcomer = await person(db, "newcomer", ["student"]);
    const client = await pool.connect();
    let join: Promise<Awaited<ReturnType<typeof joinClassWithCode>>> | undefined;
    try {
      await client.query("begin");
      await client.query(
        "select uses from class_join_codes where organization_id = $1 for update",
        [classId],
      );
      join = joinClassWithCode(db, newcomer, { code }, context);
      expect(await settlesWithin(join, 200)).toBe(false);
      // The join keeps letting the class go while the code row is taken, so this lock is granted.
      await client.query('select id from "organization" where id = $1 for update', [classId]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    expect(await join).toEqual({
      ok: true,
      value: expect.objectContaining({ status: "joined" }),
    });
  });
});
