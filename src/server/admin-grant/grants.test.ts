// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Break-glass admin grants (#48) on a real PostgreSQL 18: a grant to an existing user, a pending
// grant bound to an email-authoritative provider, its consumption at the first sign-in, expiry,
// and the last-administrator guard of a revocation.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { parseEnv } from "../env.ts";
import { keyringOf } from "../idp/crypto.ts";
import { invalidateProviderCache } from "../idp/registry.ts";
import { insertTestProvider } from "../idp/test-providers.ts";
import { VALID_ENV } from "../test-env.ts";
import {
  consumePendingAdminGrant,
  grantAdmin,
  grantAdminToUser,
  lookupUser,
  PENDING_GRANT_TTL_MS,
  pruneExpiredGrants,
  revokeAdmin,
} from "./grants.ts";

const NOW = new Date("2026-11-11T12:00:00Z");
let db: Kysely<DB> | undefined;

afterEach(async () => {
  invalidateProviderCache();
  await db?.destroy();
  db = undefined;
});

async function setup() {
  db = await createTestDb();
  const keyring = keyringOf(parseEnv(VALID_ENV));
  await insertTestProvider(db, keyring, { providerId: "entra", emailAuthoritative: true });
  await insertTestProvider(db, keyring, { providerId: "loose", emailAuthoritative: false });
  return db;
}

async function user(database: Kysely<DB>, id: string, role: string | null, emailVerified = true) {
  await database
    .insertInto("user")
    .values({ id, name: id, email: `${id}@example.test`, emailVerified, role })
    .execute();
}

async function stored(database: Kysely<DB>, id: string) {
  return database
    .selectFrom("user")
    .select(["role", "role_source"])
    .where("id", "=", id)
    .executeTakeFirst();
}

async function actions(database: Kysely<DB>) {
  const rows = await database.selectFrom("audit_event").select(["action", "actor_type"]).execute();
  return rows.map((row) => `${row.action}:${row.actor_type}`);
}

/** The refused rows, oldest first: action, target and reason code (ASVS V16.3.2). */
async function refusals(database: Kysely<DB>) {
  const rows = await database
    .selectFrom("audit_event")
    .select(["action", "actor_type", "target_id", "reason_code", "metadata"])
    .where("outcome", "=", "refused")
    .orderBy("id")
    .execute();
  return rows.map((row) => ({ ...row, metadata: row.metadata ?? null }));
}

describe("grantAdmin (#48)", () => {
  it("adds the admin role to an existing teacher as a local set, actor system", async () => {
    const database = await setup();
    await user(database, "t1", "teacher");
    expect(await grantAdmin(database, { email: "T1@example.test", now: NOW })).toEqual({
      ok: true,
      kind: "granted",
    });
    expect(await stored(database, "t1")).toEqual({ role: "teacher,admin", role_source: "local" });
    expect(await actions(database)).toEqual(["authz_role_change:system"]);
  });

  it("refuses a student (ADR 0012) and leaves an administrator as is", async () => {
    const database = await setup();
    await user(database, "s1", "student");
    await user(database, "a1", "admin");
    expect(await grantAdmin(database, { email: "s1@example.test", now: NOW })).toEqual({
      ok: false,
      error: "role_conflict",
    });
    expect(await grantAdmin(database, { email: "a1@example.test", now: NOW })).toEqual({
      ok: true,
      kind: "already_admin",
    });
    expect(await refusals(database)).toEqual([
      {
        action: "authz_role_change",
        actor_type: "system",
        target_id: "s1",
        reason_code: "role_conflict",
        metadata: null,
      },
    ]);
  });

  it("refuses a user whose email no provider verified, and logs only the refusal (V6.8.1, V16.3.2)", async () => {
    const database = await setup();
    await user(database, "t2", "teacher", false);
    expect(await grantAdmin(database, { email: "t2@example.test", now: NOW })).toEqual({
      ok: false,
      error: "email_unverified",
    });
    expect((await stored(database, "t2"))?.role).toBe("teacher");
    expect(await actions(database)).toEqual(["authz_role_change:system"]);
    expect(await refusals(database)).toEqual([
      {
        action: "authz_role_change",
        actor_type: "system",
        target_id: "t2",
        reason_code: "email_unverified",
        metadata: null,
      },
    ]);
  });

  it("grants by user id an operator looked up, whatever the email, and logs the override (#92 L4)", async () => {
    const database = await setup();
    // An Entra-only deployment: the address is not authoritative, so it is not verified.
    await user(database, "t3", "teacher", false);
    expect(await lookupUser(database, "T3@example.test")).toEqual({
      id: "t3",
      emailVerified: false,
    });
    expect(await grantAdminToUser(database, { userId: "t3", now: NOW })).toEqual({
      ok: true,
      kind: "granted",
    });
    expect(await stored(database, "t3")).toEqual({ role: "teacher,admin", role_source: "local" });
    const rows = await database
      .selectFrom("audit_event")
      .select(["action", "actor_type", "target_id", "reason_code"])
      .execute();
    expect(rows).toEqual([
      {
        action: "authz_role_change",
        actor_type: "system",
        target_id: "t3",
        reason_code: "admin_grant_override",
      },
    ]);
  });

  it("refuses an override for an unknown id or a student, and logs only the refusals (#92 L4)", async () => {
    const database = await setup();
    await user(database, "s4", "student", false);
    expect(await grantAdminToUser(database, { userId: "missing", now: NOW })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await grantAdminToUser(database, { userId: "s4", now: NOW })).toEqual({
      ok: false,
      error: "role_conflict",
    });
    expect(await lookupUser(database, "nobody@example.test")).toBeNull();
    expect((await stored(database, "s4"))?.role).toBe("student");
    expect(await refusals(database)).toEqual([
      {
        action: "authz_role_change",
        actor_type: "system",
        target_id: "missing",
        reason_code: "not_found",
        metadata: null,
      },
      {
        action: "authz_role_change",
        actor_type: "system",
        target_id: "s4",
        reason_code: "role_conflict",
        metadata: null,
      },
    ]);
    expect(await actions(database)).toHaveLength(2);
  });

  it("records a pending grant for an unknown email through an authoritative provider", async () => {
    const database = await setup();
    const missing = { email: "first@example.test", now: NOW };
    expect(await grantAdmin(database, missing)).toEqual({ ok: false, error: "provider_required" });
    expect(await grantAdmin(database, { ...missing, providerId: "nope" })).toEqual({
      ok: false,
      error: "provider_unknown",
    });
    expect(await grantAdmin(database, { ...missing, providerId: "loose" })).toEqual({
      ok: false,
      error: "provider_not_authoritative",
    });
    expect(await grantAdmin(database, { ...missing, providerId: "entra" })).toEqual({
      ok: true,
      kind: "pending",
    });
    const grant = await database
      .selectFrom("pending_admin_grant")
      .select(["email", "provider_id", "expires_at"])
      .executeTakeFirstOrThrow();
    expect(grant).toEqual({
      email: "first@example.test",
      provider_id: "entra",
      expires_at: new Date(NOW.getTime() + PENDING_GRANT_TTL_MS),
    });
    const created = await database
      .selectFrom("audit_event")
      .select(["outcome", "reason_code", "metadata"])
      .where("action", "=", "admin_grant_created")
      .orderBy("id")
      .execute();
    expect(created).toEqual([
      { outcome: "refused", reason_code: "provider_required", metadata: null },
      { outcome: "refused", reason_code: "provider_unknown", metadata: { provider_id: "nope" } },
      {
        outcome: "refused",
        reason_code: "provider_not_authoritative",
        metadata: { provider_id: "loose" },
      },
      { outcome: "success", reason_code: null, metadata: { provider_id: "entra" } },
    ]);
  });

  it("applies a pending grant once, through its own provider, before it expires", async () => {
    const database = await setup();
    await grantAdmin(database, { email: "first@example.test", providerId: "entra", now: NOW });
    const later = new Date(NOW.getTime() + 60_000);
    const consume = (providerId: string, now = later) =>
      consumePendingAdminGrant(database, { email: "first@example.test", providerId, now });
    expect(await consume("loose")).toBe(false);
    expect(await consume("entra", new Date(NOW.getTime() + PENDING_GRANT_TTL_MS + 1))).toBe(false);
    expect(await consume("entra")).toBe(true);
    expect(await consume("entra")).toBe(false);
    expect(await actions(database)).toEqual([
      "admin_grant_created:system",
      "admin_grant_applied:system",
    ]);
  });

  it("prunes expired pending grants", async () => {
    const database = await setup();
    await grantAdmin(database, { email: "old@example.test", providerId: "entra", now: NOW });
    expect(await pruneExpiredGrants(database, NOW)).toBe(0);
    expect(await pruneExpiredGrants(database, new Date(NOW.getTime() + PENDING_GRANT_TTL_MS))).toBe(
      1,
    );
  });
});

describe("revokeAdmin (#48)", () => {
  it("never takes the role from the last administrator", async () => {
    const database = await setup();
    await user(database, "a1", "admin");
    expect(await revokeAdmin(database, { email: "a1@example.test", now: NOW })).toEqual({
      ok: false,
      error: "last_admin",
    });
    expect((await stored(database, "a1"))?.role).toBe("admin");
    expect(await refusals(database)).toEqual([
      {
        action: "authz_role_change",
        actor_type: "system",
        target_id: "a1",
        reason_code: "last_admin",
        metadata: null,
      },
    ]);
  });

  it("logs a revocation for an unknown email as refused, with no target (V16.3.2)", async () => {
    const database = await setup();
    expect(await revokeAdmin(database, { email: "nobody@example.test", now: NOW })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await refusals(database)).toEqual([
      {
        action: "authz_role_change",
        actor_type: "system",
        target_id: null,
        reason_code: "not_found",
        metadata: null,
      },
    ]);
  });

  it("keeps the other roles, ends the sessions and logs the change", async () => {
    const database = await setup();
    await user(database, "a1", "admin");
    await user(database, "c1", "teacher,admin");
    await database
      .insertInto("session")
      .values({
        id: "s1",
        token: "t",
        userId: "c1",
        expiresAt: new Date(Date.now() + 60_000),
        updatedAt: new Date(),
      })
      .execute();
    expect(await revokeAdmin(database, { email: "c1@example.test", now: NOW })).toEqual({
      ok: true,
      kind: "revoked",
    });
    expect(await stored(database, "c1")).toEqual({ role: "teacher", role_source: "local" });
    expect(await database.selectFrom("session").select("id").execute()).toEqual([]);
  });

  it("withdraws a pending grant, and reports an unknown email", async () => {
    const database = await setup();
    await grantAdmin(database, { email: "p@example.test", providerId: "entra", now: NOW });
    expect(await revokeAdmin(database, { email: "p@example.test", now: NOW })).toEqual({
      ok: true,
      kind: "revoked",
    });
    expect(await revokeAdmin(database, { email: "nobody@example.test", now: NOW })).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});
