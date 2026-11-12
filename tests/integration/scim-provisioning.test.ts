// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// SCIM 2.0 provisioning through eduLIMS's own better-auth handler on a real PostgreSQL (#45,
// ADR 0017, B1): the directory creates, changes, deactivates, reactivates and deletes users;
// its groups give roles only through the provider's role map; every refusal of a token is
// asserted, and a token of one provider never reaches another provider's users. The people
// are the fixed pseudonymised test set (`@example.test`).
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Auth } from "../../src/server/auth.ts";
import type { DB } from "../../src/server/db/schema.gen.ts";
import { createTestDb } from "../../src/server/db/test-db.ts";
import { parseEnv } from "../../src/server/env.ts";
import { keyringOf } from "../../src/server/idp/crypto.ts";
import { invalidateProviderCache } from "../../src/server/idp/registry.ts";
import { insertTestProvider } from "../../src/server/idp/test-providers.ts";
import { createScimToken, revokeScimToken } from "../../src/server/scim/tokens.ts";
import { createTestAuth } from "../../src/server/test-auth.ts";
import { VALID_ENV } from "../../src/server/test-env.ts";

const BASE = "http://localhost:3000";
const USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const GROUP_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Group";
const PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

const ROLE_MAP = {
  "grp-teachers": "teacher",
  "grp-students": "student",
  "grp-admins": "admin",
};

let db: Kysely<DB>;
let auth: Auth;
let tokenA: string;
let tokenB: string;

async function scim(
  method: string,
  path: string,
  token: string | null,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const headers = new Headers({ "content-type": "application/scim+json" });
  if (token !== null) headers.set("authorization", `Bearer ${token}`);
  const response = await auth.handler(
    new Request(`${BASE}/api/auth/scim/v2${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
  const text = await response.text();
  const json: unknown = text === "" ? {} : JSON.parse(text);
  return {
    status: response.status,
    json: typeof json === "object" && json !== null ? (json as Record<string, unknown>) : {},
  };
}

function userBody(externalId: string, email: string, extra: Record<string, unknown> = {}) {
  return {
    schemas: [USER_SCHEMA],
    externalId,
    userName: email,
    displayName: "Sanne Visser",
    name: { givenName: "Sanne", familyName: "Visser" },
    emails: [{ value: email, type: "work", primary: true }],
    active: true,
    ...extra,
  };
}

async function createUser(token: string, externalId: string, email: string) {
  const created = await scim("POST", "/Users", token, userBody(externalId, email));
  expect(created.status).toBe(201);
  const scimId = String(created.json["id"]);
  const row = await db
    .selectFrom("scimUser")
    .select("userId")
    .where("id", "=", scimId)
    .executeTakeFirstOrThrow();
  return { scimId, userId: row.userId };
}

function readUser(userId: string) {
  return db
    .selectFrom("user")
    .select(["name", "role", "role_source", "provisioned_by", "deprovisioned_at"])
    .where("id", "=", userId)
    .executeTakeFirstOrThrow();
}

async function insertSession(userId: string, id: string): Promise<void> {
  await db
    .insertInto("session")
    .values({
      id,
      token: `token-${id}`,
      userId,
      expiresAt: new Date(Date.now() + 3_600_000),
      updatedAt: new Date(),
    })
    .execute();
}

async function sessionCount(userId: string): Promise<number> {
  const rows = await db.selectFrom("session").select("id").where("userId", "=", userId).execute();
  return rows.length;
}

async function actions(): Promise<string[]> {
  const rows = await db.selectFrom("audit_event").select("action").orderBy("id").execute();
  return rows.map((row) => row.action);
}

function patch(operations: unknown[]) {
  return { schemas: [PATCH_SCHEMA], Operations: operations };
}

beforeEach(async () => {
  db = await createTestDb();
  const env = parseEnv(VALID_ENV);
  auth = await createTestAuth(env, { db, type: "postgres" });
  const keyring = keyringOf(env);
  await insertTestProvider(db, keyring, { providerId: "campus", roleMap: ROLE_MAP });
  await insertTestProvider(db, keyring, {
    providerId: "partner",
    issuer: "https://partner.example.test",
  });
  const system = { db, actor: { type: "system" as const } };
  const a = await createScimToken(system, "campus");
  const b = await createScimToken(system, "partner");
  if (!a.ok || !b.ok) throw new Error("token setup failed");
  tokenA = a.token;
  tokenB = b.token;
});

afterEach(async () => {
  invalidateProviderCache();
  await db.destroy();
});

describe("SCIM provisioning (#45)", () => {
  it("creates a user before the first sign-in, with no roles and the provider as its source", async () => {
    const { userId } = await createUser(tokenA, "dir-0001", "s.visser@example.test");
    const user = await readUser(userId);
    expect(user).toMatchObject({
      name: "Sanne Visser",
      role: null,
      role_source: "local",
      provisioned_by: "campus",
      deprovisioned_at: null,
    });
    expect(await actions()).toEqual(expect.arrayContaining(["user_created", "scim_user_created"]));
  });

  it("patches a user's profile", async () => {
    const { scimId, userId } = await createUser(tokenA, "dir-0002", "j.bos@example.test");
    const patched = await scim(
      "PATCH",
      `/Users/${scimId}`,
      tokenA,
      patch([{ op: "replace", path: "displayName", value: "Jan Bos" }]),
    );
    expect(patched.status).toBe(200);
    expect((await readUser(userId)).name).toBe("Jan Bos");
    expect(await actions()).toContain("scim_user_updated");
  });

  it("deactivates: ends every session at once, refuses a new one, keeps the records", async () => {
    const { scimId, userId } = await createUser(tokenA, "dir-0003", "l.smit@example.test");
    await insertSession(userId, "s-1");
    await insertSession(userId, "s-2");
    const deactivated = await scim(
      "PATCH",
      `/Users/${scimId}`,
      tokenA,
      patch([{ op: "replace", path: "active", value: false }]),
    );
    expect(deactivated.status).toBe(200);
    expect(await sessionCount(userId)).toBe(0);
    const user = await readUser(userId);
    expect(user.deprovisioned_at).toBeInstanceOf(Date);
    expect(user.name).toBe("Sanne Visser");
    const context = await auth.$context;
    await expect(context.internalAdapter.createSession(userId)).rejects.toMatchObject({
      body: { code: "account_deprovisioned" },
    });
    expect(await actions()).toContain("user_deprovisioned");
    const revoked = await db
      .selectFrom("audit_event")
      .select("reason_code")
      .where("action", "=", "session_revoked")
      .execute();
    expect(revoked).toEqual([
      { reason_code: "user_deprovisioned" },
      { reason_code: "user_deprovisioned" },
    ]);
  });

  it("reactivates: sign-in works again", async () => {
    const { scimId, userId } = await createUser(tokenA, "dir-0004", "m.jansen@example.test");
    const off = patch([{ op: "replace", path: "active", value: false }]);
    expect((await scim("PATCH", `/Users/${scimId}`, tokenA, off)).status).toBe(200);
    const on = patch([{ op: "replace", path: "active", value: true }]);
    expect((await scim("PATCH", `/Users/${scimId}`, tokenA, on)).status).toBe(200);
    expect((await readUser(userId)).deprovisioned_at).toBeNull();
    const context = await auth.$context;
    const session = await context.internalAdapter.createSession(userId);
    expect(session.userId).toBe(userId);
    expect(await actions()).toContain("user_reprovisioned");
  });

  it("deletes: the SCIM User goes, the eduLIMS user stays deprovisioned (no erasure, #47)", async () => {
    const { scimId, userId } = await createUser(tokenA, "dir-0005", "e.dekker@example.test");
    await insertSession(userId, "s-3");
    expect((await scim("DELETE", `/Users/${scimId}`, tokenA)).status).toBe(204);
    expect((await scim("GET", `/Users/${scimId}`, tokenA)).status).toBe(404);
    expect(await sessionCount(userId)).toBe(0);
    expect(await readUser(userId)).toMatchObject({ provisioned_by: "campus" });
    expect((await readUser(userId)).deprovisioned_at).toBeInstanceOf(Date);
    expect(await actions()).toContain("scim_user_deleted");
  });

  it("lists users with a filter", async () => {
    await createUser(tokenA, "dir-0006", "a.vries@example.test");
    await createUser(tokenA, "dir-0007", "b.vries@example.test");
    const filter = encodeURIComponent('userName eq "b.vries@example.test"');
    const listed = await scim("GET", `/Users?filter=${filter}`, tokenA);
    expect(listed.status).toBe(200);
    expect(listed.json["totalResults"]).toBe(1);
    const all = await scim("GET", "/Users", tokenA);
    expect(all.json["totalResults"]).toBe(2);
  });
});

describe("roles from SCIM groups follow the provider's role map (#32, #45)", () => {
  it("a mapped group is authoritative, and taking it away leaves no roles", async () => {
    const { scimId, userId } = await createUser(tokenA, "dir-0010", "t.mulder@example.test");
    const group = await scim("POST", "/Groups", tokenA, {
      schemas: [GROUP_SCHEMA],
      externalId: "grp-teachers",
      displayName: "Teachers",
      members: [{ value: scimId }],
    });
    expect(group.status).toBe(201);
    expect(await readUser(userId)).toMatchObject({ role: "teacher", role_source: "campus" });
    const removed = await scim(
      "PATCH",
      `/Groups/${String(group.json["id"])}`,
      tokenA,
      patch([{ op: "remove", path: `members[value eq "${scimId}"]` }]),
    );
    expect(removed.status).toBe(200);
    expect(await readUser(userId)).toMatchObject({ role: null, role_source: "local" });
  });

  it("never grants admin from a group the role map does not map", async () => {
    const { scimId, userId } = await createUser(tokenA, "dir-0011", "k.peters@example.test");
    const group = await scim("POST", "/Groups", tokenA, {
      schemas: [GROUP_SCHEMA],
      externalId: "grp-it-admins",
      displayName: "admin",
      members: [{ value: scimId }],
    });
    expect(group.status).toBe(201);
    expect(await readUser(userId)).toMatchObject({ role: null, role_source: "local" });
  });

  it("keeps a local role set when no group maps a role", async () => {
    const { userId } = await createUser(tokenA, "dir-0012", "r.meijer@example.test");
    await db.updateTable("user").set({ role: "teacher" }).where("id", "=", userId).execute();
    const group = await scim("POST", "/Groups", tokenA, {
      schemas: [GROUP_SCHEMA],
      displayName: "Lab staff",
    });
    expect(group.status).toBe(201);
    expect(await readUser(userId)).toMatchObject({ role: "teacher", role_source: "local" });
  });

  it("refuses a conflicting set (student with teacher) with no roles", async () => {
    const { scimId, userId } = await createUser(tokenA, "dir-0013", "d.kok@example.test");
    for (const externalId of ["grp-students", "grp-teachers"]) {
      const group = await scim("POST", "/Groups", tokenA, {
        schemas: [GROUP_SCHEMA],
        externalId,
        displayName: externalId,
        members: [{ value: scimId }],
      });
      expect(group.status).toBe(201);
    }
    expect(await readUser(userId)).toMatchObject({ role: null, role_source: "campus" });
  });
});

describe("SCIM refusals (#45, ASVS V6, API2)", () => {
  it("refuses a request without a token", async () => {
    expect((await scim("GET", "/Users", null)).status).toBe(401);
  });

  it("refuses an unknown token", async () => {
    const bad = `edulims_scim_${"A".repeat(43)}`;
    expect((await scim("GET", "/Users", bad)).status).toBe(401);
    expect((await scim("POST", "/Users", bad, userBody("x", "x@example.test"))).status).toBe(401);
    // One refused row per token per window (H2, L2), with the reason and no provider.
    const rows = await db
      .selectFrom("audit_event")
      .select(["action", "outcome", "reason_code", "actor_type"])
      .where("action", "=", "scim_token_refused")
      .execute();
    expect(rows).toEqual([
      {
        action: "scim_token_refused",
        outcome: "refused",
        reason_code: "token_unknown",
        actor_type: "anonymous",
      },
    ]);
  });

  async function refusalReasons(): Promise<(string | null)[]> {
    const rows = await db
      .selectFrom("audit_event")
      .select("reason_code")
      .where("action", "=", "scim_token_refused")
      .orderBy("id")
      .execute();
    return rows.map((row) => row.reason_code);
  }

  it("refuses a revoked token, and logs why", async () => {
    await revokeScimToken({ db, actor: { type: "system" } }, "campus");
    expect((await scim("GET", "/Users", tokenA)).status).toBe(401);
    expect(await refusalReasons()).toEqual(["token_revoked"]);
  });

  it("refuses the token of a disabled provider, and logs why", async () => {
    await db
      .updateTable("identity_provider")
      .set({ enabled: false })
      .where("provider_id", "=", "campus")
      .execute();
    expect((await scim("GET", "/Users", tokenA)).status).toBe(401);
    expect(await refusalReasons()).toEqual(["provider_disabled"]);
  });

  it("refuses an expired token, and logs why", async () => {
    await db
      .updateTable("scim_token")
      .set({
        created_at: new Date("2026-01-01T00:00:00Z"),
        expires_at: new Date("2026-02-01T00:00:00Z"),
      })
      .where("provider_id", "=", "campus")
      .execute();
    expect((await scim("GET", "/Users", tokenA)).status).toBe(401);
    expect(await refusalReasons()).toEqual(["token_expired"]);
  });

  it("logs a request without a token as token_missing", async () => {
    expect((await scim("GET", "/Groups", null)).status).toBe(401);
    expect(await refusalReasons()).toEqual(["token_missing"]);
  });

  it("refuses a body over the size cap with 413", async () => {
    const body = userBody("big", "big@example.test", { title: "x".repeat(1_100_000) });
    expect((await scim("POST", "/Users", tokenA, body)).status).toBe(413);
  });
});

describe("a token of one provider never reaches another provider's users (A01, API1)", () => {
  it("does not read, list, change or delete them", async () => {
    const { scimId, userId } = await createUser(tokenB, "dir-0020", "p.jong@example.test");
    expect((await scim("GET", `/Users/${scimId}`, tokenA)).status).toBe(404);
    const listed = await scim("GET", "/Users", tokenA);
    expect(listed.json["totalResults"]).toBe(0);
    const off = patch([{ op: "replace", path: "active", value: false }]);
    expect((await scim("PATCH", `/Users/${scimId}`, tokenA, off)).status).toBe(404);
    expect((await scim("DELETE", `/Users/${scimId}`, tokenA)).status).toBe(404);
    expect(await readUser(userId)).toMatchObject({
      provisioned_by: "partner",
      deprovisioned_at: null,
    });
    const refused = await db
      .selectFrom("audit_event")
      .select(["action", "outcome", "provider"])
      .where("outcome", "=", "refused")
      .where("action", "like", "scim_user_%")
      .orderBy("id")
      .execute();
    // A cross-provider read is a refused row too (H2, V16.3.2).
    expect(refused).toEqual([
      { action: "scim_user_read", outcome: "refused", provider: "campus" },
      { action: "scim_user_updated", outcome: "refused", provider: "campus" },
      { action: "scim_user_deleted", outcome: "refused", provider: "campus" },
    ]);
  });

  it("cannot claim the same externalId's user through another provider", async () => {
    const { userId } = await createUser(tokenB, "dir-0021", "q.wit@example.test");
    const other = await scim("POST", "/Users", tokenA, userBody("dir-0021", "q.wit@example.test"));
    expect(other.status).toBe(409);
    expect(await readUser(userId)).toMatchObject({ provisioned_by: "partner" });
  });
});
