// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The findings of the SCIM security review (#45, PR #108) through eduLIMS's own better-auth
// handler on a real PostgreSQL: the role channel (B1, ASVS V8.2.1), one owner per e-mail
// address (H1, V6.8.1), the rate limit for unverified tokens (H3, V2.4.1) and the link on the
// directory id a sign-in stored (M1). The people are the fixed test set (`@example.test`).
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Auth } from "../../src/server/auth.ts";
import type { DB } from "../../src/server/db/schema.gen.ts";
import { createTestDb } from "../../src/server/db/test-db.ts";
import { parseEnv } from "../../src/server/env.ts";
import { keyringOf } from "../../src/server/idp/crypto.ts";
import { invalidateProviderCache } from "../../src/server/idp/registry.ts";
import { insertTestProvider } from "../../src/server/idp/test-providers.ts";
import { createScimToken, generateScimToken } from "../../src/server/scim/tokens.ts";
import { createTestAuth } from "../../src/server/test-auth.ts";
import { VALID_ENV } from "../../src/server/test-env.ts";

const BASE = "http://localhost:3000";
const USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

let db: Kysely<DB>;
let auth: Auth;
let tokenA: string;
let tokenB: string;

async function scim(method: string, path: string, token: string | null, body?: unknown) {
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
    json: typeof json === "object" && json !== null ? Object.fromEntries(Object.entries(json)) : {},
  };
}

function userBody(externalId: string, email: string) {
  return {
    schemas: [USER_SCHEMA],
    externalId,
    userName: email,
    displayName: "Lotte Brouwer",
    emails: [{ value: email, primary: true }],
    active: true,
  };
}

async function insertUser(
  id: string,
  email: string,
  extra: { role?: string; role_source?: string; role_channel?: string } = {},
) {
  await db
    .insertInto("user")
    .values({ id, name: "Lotte Brouwer", email, emailVerified: true, ...extra })
    .execute();
}

async function insertAccount(
  userId: string,
  providerId: string,
  accountId: string,
  directoryId?: string,
) {
  const now = new Date();
  await db
    .insertInto("account")
    .values({
      id: `acc-${userId}-${providerId}`,
      accountId,
      providerId,
      userId,
      createdAt: now,
      updatedAt: now,
      ...(directoryId ? { directory_id: directoryId } : {}),
    })
    .execute();
}

beforeEach(async () => {
  db = await createTestDb();
  const env = parseEnv(VALID_ENV);
  auth = await createTestAuth(env, { db, type: "postgres" });
  const keyring = keyringOf(env);
  await insertTestProvider(db, keyring, {
    providerId: "campus",
    roleMap: { "grp-teachers": "teacher", "edulims-admin": "admin" },
  });
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

describe("B1: a SCIM write never removes a role an ID-token claim gave", () => {
  it("leaves the claim's admin in place on a SCIM PATCH without a mapped group", async () => {
    const created = await scim(
      "POST",
      "/Users",
      tokenA,
      userBody("dir-1", "l.brouwer@example.test"),
    );
    expect(created.status).toBe(201);
    const scimId = String(created.json["id"]);
    const { userId } = await db
      .selectFrom("scimUser")
      .select("userId")
      .where("id", "=", scimId)
      .executeTakeFirstOrThrow();
    // The user signed in and the ID token's role claim mapped to admin.
    await db
      .updateTable("user")
      .set({ role: "admin", role_source: "campus", role_channel: "claim" })
      .where("id", "=", userId)
      .execute();
    const patched = await scim("PATCH", `/Users/${scimId}`, tokenA, {
      schemas: [PATCH_SCHEMA],
      Operations: [{ op: "replace", path: "displayName", value: "L. Brouwer" }],
    });
    expect(patched.status).toBe(200);
    const user = await db
      .selectFrom("user")
      .select(["role", "role_source", "role_channel"])
      .where("id", "=", userId)
      .executeTakeFirstOrThrow();
    expect(user).toEqual({ role: "admin", role_source: "campus", role_channel: "claim" });
  });
});

describe("H1: one owner per e-mail address", () => {
  it("refuses another provider's create with a generic 409, and the owner's create still links", async () => {
    await insertUser("u-a", "k.smit@example.test", {
      role: "teacher",
      role_source: "campus",
      role_channel: "claim",
    });
    await insertAccount("u-a", "campus", "sub-k-smit");

    const squat = await scim("POST", "/Users", tokenB, userBody("p-1", "k.smit@example.test"));
    expect(squat.status).toBe(409);
    expect(squat.json).toEqual({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "409",
      scimType: "uniqueness",
      detail: "A resource with these values already exists",
    });
    expect(JSON.stringify(squat.json)).not.toMatch(/campus|u-a|k\.smit/);
    const refused = await db
      .selectFrom("audit_event")
      .select(["action", "outcome", "reason_code", "provider"])
      .where("outcome", "=", "refused")
      .execute();
    expect(refused).toEqual([
      {
        action: "scim_user_created",
        outcome: "refused",
        reason_code: "uniqueness",
        provider: "partner",
      },
    ]);
    expect(await db.selectFrom("scimUser").select("id").execute()).toEqual([]);

    // The owner's directory provisions the same person: it links to the existing user.
    const own = await scim("POST", "/Users", tokenA, userBody("sub-k-smit", "k.smit@example.test"));
    expect(own.status).toBe(201);
    const link = await db
      .selectFrom("scimUser")
      .select("userId")
      .where("id", "=", String(own.json["id"]))
      .executeTakeFirstOrThrow();
    expect(link.userId).toBe("u-a");
    // And the owner still gets a session.
    const context = await auth.$context;
    expect((await context.internalAdapter.createSession("u-a")).userId).toBe("u-a");
  });

  it("refuses a PATCH that would move a user onto an address another provider owns", async () => {
    await insertUser("u-b", "j.vos@example.test");
    await insertAccount("u-b", "campus", "sub-j-vos");
    const created = await scim("POST", "/Users", tokenB, userBody("p-2", "p.two@example.test"));
    expect(created.status).toBe(201);
    const moved = await scim("PATCH", `/Users/${String(created.json["id"])}`, tokenB, {
      schemas: [PATCH_SCHEMA],
      Operations: [{ op: "replace", path: "userName", value: "j.vos@example.test" }],
    });
    expect(moved.status).toBe(409);
    expect(moved.json["scimType"]).toBe("uniqueness");
  });
});

describe("H3: unverified tokens share one bucket per client IP", () => {
  it("answers 429 to the 601st request with distinct random tokens", {
    timeout: 60_000,
  }, async () => {
    for (let i = 0; i < 600; i += 1) {
      expect((await scim("GET", "/Users", generateScimToken())).status).toBe(401);
    }
    const limited = await scim("GET", "/Users", generateScimToken());
    expect(limited.status).toBe(429);
    // A working token is counted against its own provider, not that bucket.
    expect((await scim("GET", "/Users", tokenA)).status).toBe(200);
  });
});

describe("M1: SCIM links the user a sign-in stored the directory id on", () => {
  it("links on the account's directory id, and deprovisioning ends that user's sessions", async () => {
    await db
      .updateTable("identity_provider")
      .set({ scim_external_id_claim: "oid" })
      .where("provider_id", "=", "campus")
      .execute();
    invalidateProviderCache();
    await insertUser("u-c", "m.bakker@example.test", {
      role: "teacher",
      role_source: "campus",
      role_channel: "claim",
    });
    await insertAccount("u-c", "campus", "pairwise-sub", "object-id-7");
    const context = await auth.$context;
    await context.internalAdapter.createSession("u-c");

    const created = await scim(
      "POST",
      "/Users",
      tokenA,
      userBody("object-id-7", "m.bakker@example.test"),
    );
    expect(created.status).toBe(201);
    const scimId = String(created.json["id"]);
    const link = await db
      .selectFrom("scimUser")
      .select("userId")
      .where("id", "=", scimId)
      .executeTakeFirstOrThrow();
    expect(link.userId).toBe("u-c");

    const off = await scim("PATCH", `/Users/${scimId}`, tokenA, {
      schemas: [PATCH_SCHEMA],
      Operations: [{ op: "replace", path: "active", value: false }],
    });
    expect(off.status).toBe(200);
    expect(
      await db.selectFrom("session").select("id").where("userId", "=", "u-c").execute(),
    ).toEqual([]);
  });
});
