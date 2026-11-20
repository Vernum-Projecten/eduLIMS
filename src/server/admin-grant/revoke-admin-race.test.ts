// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The paths that take the admin role away or block an administrator, in a forced order on a
// committed database (#345, #356 review, B4, Q-SEC-2): two revocations, a revocation and a
// deletion, two role edits, two blocks, each on the last two administrators, and a target that
// gains the admin role while it is awaited. A third connection holds the first administrator
// row, both operations queue behind it in a known order, and the hold is released.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { type CommittedTestDb, createCommittedTestDb } from "../db/test-committed-db.ts";
import { inUserOrder, lockWaiters } from "../db/test-lock-waiters.ts";
import { parseEnv } from "../env.ts";
import { AuthError } from "../middleware.ts";
import { createTestAuth } from "../test-auth.ts";
import { VALID_ENV } from "../test-env.ts";
import { type AdminActionResult, blockUser, setLocalRoles } from "../users/actions.ts";
import { isBlocked, NOT_AN_ADMIN } from "../users/administrators.ts";
import { type DeleteUserResult, deleteUser, LAST_ADMIN } from "../users/delete-user.ts";
import { insertSignedInUser } from "../users/test-helpers.ts";
import { type GrantResult, revokeAdmin } from "./grants.ts";

const NOW = new Date("2026-11-20T12:00:00Z");
let committed: CommittedTestDb | undefined;

afterEach(async () => {
  await committed?.destroy();
  committed = undefined;
});

/** The last two administrators, `first` with the lower id, and a third user who is a teacher. */
async function world() {
  committed = await createCommittedTestDb(12);
  const database = committed;
  const { db } = database;
  const auth = await createTestAuth(parseEnv({ ...VALID_ENV, EDULIMS_DEV_LOGIN: "true" }), {
    db,
    type: "postgres",
  });
  // No password hashing: on a busy runner it, not the race, would use up the time budget.
  const ids = [
    { email: "one@example.test", id: await insertSignedInUser(db, "one@example.test", ["admin"]) },
    {
      email: "two@example.test",
      id: await insertSignedInUser(db, "two@example.test", ["teacher", "admin"]),
    },
  ].toSorted((a, b) => a.id.localeCompare(b.id));
  const [first, second] = ids;
  if (!first || !second) throw new Error("two administrators expected");
  await insertSignedInUser(db, "teacher@example.test", ["teacher"]);
  const contextOf = (actorId: string) => ({
    auth,
    db,
    headers: new Headers(),
    now: NOW,
    actor: { id: actorId, roles: ["admin"] as const },
  });
  const revoke = (email: string) => () => revokeAdmin(db, { email, now: NOW });
  return { database, db, first, second, contextOf, revoke };
}

async function stateOf(db: Kysely<DB>, userId: string) {
  const [user, sessions] = await Promise.all([
    db
      .selectFrom("user")
      .select(["role", "role_source"])
      .where("id", "=", userId)
      .executeTakeFirst(),
    db.selectFrom("session").select("id").where("userId", "=", userId).execute(),
  ]);
  return { user: user ?? null, sessions: sessions.length };
}

async function administrators(db: Kysely<DB>) {
  const rows = await db
    .selectFrom("user")
    .select("id")
    .where("role", "in", ["admin", "teacher,admin"])
    .orderBy("id")
    .execute();
  return rows.map((row) => row.id);
}

async function refusals(db: Kysely<DB>) {
  return db
    .selectFrom("audit_event")
    .select(["action", "actor_type", "reason_code", "target_id"])
    .where("outcome", "=", "refused")
    .orderBy("occurred_at")
    .orderBy("id")
    .execute();
}

describe("two revocations of the last two administrators (#345)", () => {
  it("one revocation wins and the other is refused with last_admin", async () => {
    const { database, db, first, second, revoke } = await world();
    const before = await stateOf(db, second.id);
    const [one, two] = await inUserOrder<GrantResult, GrantResult>(
      database,
      first.id,
      revoke(first.email),
      revoke(second.email),
    );
    expect(one).toEqual({ ok: true, kind: "revoked" });
    expect(two).toEqual({ ok: false, error: LAST_ADMIN });
    expect(await administrators(db)).toEqual([second.id]);
    expect(await stateOf(db, second.id)).toEqual(before);
    expect(await refusals(db)).toEqual([
      {
        action: "authz_role_change",
        actor_type: "system",
        reason_code: LAST_ADMIN,
        target_id: second.id,
      },
    ]);
  });

  it("in the other order the second administrator's revocation wins", async () => {
    const { database, db, first, second, revoke } = await world();
    const before = await stateOf(db, first.id);
    const [one, two] = await inUserOrder<GrantResult, GrantResult>(
      database,
      first.id,
      revoke(second.email),
      revoke(first.email),
    );
    expect(one).toEqual({ ok: true, kind: "revoked" });
    expect(two).toEqual({ ok: false, error: LAST_ADMIN });
    expect(await administrators(db)).toEqual([first.id]);
    expect(await stateOf(db, first.id)).toEqual(before);
  });
});

/** Returns the outcome of `run`, or the error it threw, so a forced order never rejects early. */
function settled<T>(run: () => Promise<T>): () => Promise<T | unknown> {
  return () => run().catch((error: unknown) => error);
}

describe("a revocation and a deletion of the last two administrators (#345)", () => {
  it("revocation first: the deleter lost the role, so the deletion is refused with 403", async () => {
    const { database, db, first, second, contextOf, revoke } = await world();
    const before = await stateOf(db, second.id);
    const [revoked, deleted] = await inUserOrder(
      database,
      first.id,
      revoke(first.email),
      settled(() => deleteUser(contextOf(first.id), { userId: second.id })),
    );
    expect(revoked).toEqual({ ok: true, kind: "revoked" });
    expect(deleted).toBeInstanceOf(AuthError);
    expect(await administrators(db)).toEqual([second.id]);
    expect(await stateOf(db, second.id)).toEqual(before);
    expect(await refusals(db)).toEqual([
      {
        action: "user_deleted",
        actor_type: "user",
        reason_code: NOT_AN_ADMIN,
        target_id: second.id,
      },
    ]);
  });

  it("deletion first: the revocation is refused and the administrator keeps the role", async () => {
    const { database, db, first, second, contextOf, revoke } = await world();
    const before = await stateOf(db, first.id);
    const [deleted, revoked] = await inUserOrder<DeleteUserResult, GrantResult>(
      database,
      first.id,
      () => deleteUser(contextOf(first.id), { userId: second.id }),
      revoke(first.email),
    );
    expect(deleted).toEqual({ ok: true });
    expect(revoked).toEqual({ ok: false, error: LAST_ADMIN });
    expect(await administrators(db)).toEqual([first.id]);
    expect(await stateOf(db, first.id)).toEqual(before);
    expect(await refusals(db)).toEqual([
      {
        action: "authz_role_change",
        actor_type: "system",
        reason_code: LAST_ADMIN,
        target_id: first.id,
      },
    ]);
  });
});

describe("two administrators who take the admin role from each other (#345)", () => {
  it("one role edit wins and the other, whose actor lost the role, is refused with 403", async () => {
    const { database, db, first, second, contextOf } = await world();
    const before = await stateOf(db, first.id);
    const [one, two] = await inUserOrder(
      database,
      first.id,
      () => setLocalRoles(contextOf(first.id), { userId: second.id, roles: ["teacher"] }),
      settled(() => setLocalRoles(contextOf(second.id), { userId: first.id, roles: ["teacher"] })),
    );
    expect(one).toEqual({ ok: true });
    expect(two).toBeInstanceOf(AuthError);
    expect(await administrators(db)).toEqual([first.id]);
    expect(await stateOf(db, first.id)).toEqual(before);
    expect(await refusals(db)).toEqual([
      {
        action: "authz_role_change",
        actor_type: "user",
        reason_code: NOT_AN_ADMIN,
        target_id: first.id,
      },
    ]);
  });

  it("a revocation and a role edit: the later one is refused with 403", async () => {
    const { database, db, first, second, contextOf, revoke } = await world();
    const [revoked, edited] = await inUserOrder(
      database,
      first.id,
      revoke(second.email),
      settled(() => setLocalRoles(contextOf(second.id), { userId: first.id, roles: ["teacher"] })),
    );
    expect(revoked).toEqual({ ok: true, kind: "revoked" });
    expect(edited).toBeInstanceOf(AuthError);
    expect(await administrators(db)).toEqual([first.id]);
  });
});

async function unblocked(db: Kysely<DB>) {
  const rows = await db
    .selectFrom("user")
    .select(["id", "banned", "banExpires"])
    .where("role", "in", ["admin", "teacher,admin"])
    .orderBy("id")
    .execute();
  return rows.filter((row) => !isBlocked(row, new Date())).map((row) => row.id);
}

describe("two administrators who block each other (#356 review, S3)", () => {
  it("one block wins and the other is refused with last_admin", async () => {
    const { database, db, first, second, contextOf } = await world();
    const block = (actor: string, target: string) => () =>
      blockUser(contextOf(actor), { userId: target, reason: "Forced order", until: "" });
    const [one, two] = await inUserOrder<AdminActionResult, AdminActionResult>(
      database,
      first.id,
      block(first.id, second.id),
      block(second.id, first.id),
    );
    expect(one).toEqual({ ok: true });
    expect(two).toEqual({ ok: false, error: LAST_ADMIN });
    expect(await unblocked(db)).toEqual([first.id]);
    expect(await refusals(db)).toEqual([
      { action: "user_banned", actor_type: "user", reason_code: LAST_ADMIN, target_id: first.id },
    ]);
  });
});

describe("a target that gains the admin role while it is awaited (#356 review, N1)", () => {
  it("queues instead of deadlocking, and one administrator stays", async () => {
    const { database, db, first, second, contextOf } = await world();
    const third = await insertSignedInUser(db, "third@example.test", ["teacher"]);
    expect([first.id, second.id, third].toSorted()).toEqual([first.id, second.id, third]);
    const holder = await database.pool.connect();
    try {
      await holder.query("begin");
      await holder.query(`update "user" set role = 'teacher,admin' where id = $1`, [third]);
      await holder.query(`select id from "user" where id = $1 for update`, [first.id]);
      const edit = setLocalRoles(contextOf(second.id), { userId: third, roles: ["teacher"] });
      await lockWaiters(database, 1);
      const revoke = revokeAdmin(db, { email: second.email, now: NOW });
      await lockWaiters(database, 2);
      await holder.query("commit");
      expect(await Promise.all([edit, revoke])).toEqual([
        { ok: true },
        { ok: true, kind: "revoked" },
      ]);
    } finally {
      holder.release();
    }
    expect(await administrators(db)).toEqual([first.id]);
  });
});
