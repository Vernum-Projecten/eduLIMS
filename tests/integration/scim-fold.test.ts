// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// A SCIM write whose address only looks ASCII after lower-casing is refused (#324; ASVS 5.0
// V6.8.1), through eduLIMS's own better-auth handler on a real PostgreSQL. The plugin lower-cases
// every address before it stores one, so a directory could otherwise provision the ASCII address
// of someone else: the place waiting for it in a lab, or the teacher a colleague adds by it.
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EMAIL_FOLD_ERROR } from "../../src/lib/identity-providers.ts";
import type { Auth } from "../../src/server/auth.ts";
import type { DB } from "../../src/server/db/schema.gen.ts";
import { createTestDb } from "../../src/server/db/test-db.ts";
import { parseEnv } from "../../src/server/env.ts";
import { keyringOf } from "../../src/server/idp/crypto.ts";
import { invalidateProviderCache } from "../../src/server/idp/registry.ts";
import { insertTestProvider } from "../../src/server/idp/test-providers.ts";
import { createScimToken } from "../../src/server/scim/tokens.ts";
import { createTestAuth } from "../../src/server/test-auth.ts";
import { VALID_ENV } from "../../src/server/test-env.ts";

const BASE = "http://localhost:3000";
const USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
/** `kim@example.test` with U+212A KELVIN SIGN for its `k`. */
const KELVIN = "Kim@example.test";

let db: Kysely<DB>;
let auth: Auth;
let token: string;

async function scim(method: string, path: string, body: unknown) {
  const response = await auth.handler(
    new Request(`${BASE}/api/auth/scim/v2${path}`, {
      method,
      headers: { "content-type": "application/scim+json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }),
  );
  const text = await response.text();
  const json: unknown = text === "" ? {} : JSON.parse(text);
  return {
    status: response.status,
    json: typeof json === "object" && json !== null ? Object.fromEntries(Object.entries(json)) : {},
  };
}

function userBody(externalId: string, userName: string, email = userName) {
  return {
    schemas: [USER_SCHEMA],
    externalId,
    userName,
    displayName: "Kim Visser",
    emails: [{ value: email, primary: true }],
    active: true,
  };
}

async function refusals() {
  return db
    .selectFrom("audit_event")
    .select(["action", "reason_code"])
    .where("outcome", "=", "refused")
    .execute();
}

beforeEach(async () => {
  db = await createTestDb();
  const env = parseEnv(VALID_ENV);
  auth = await createTestAuth(env, { db, type: "postgres" });
  await insertTestProvider(db, keyringOf(env), { providerId: "campus" });
  const created = await createScimToken({ db, actor: { type: "system" } }, "campus");
  if (!created.ok) throw new Error("token setup failed");
  token = created.token;
});

afterEach(async () => {
  invalidateProviderCache();
  await db.destroy();
});

describe("SCIM refuses an address that folds onto an ASCII one (#324)", () => {
  it.each([
    ["userName and emails", userBody("d-1", KELVIN)],
    ["emails only", userBody("d-2", "kim-visser", KELVIN)],
  ])("refuses a create with the KELVIN SIGN form in %s, creating nobody", async (_where, body) => {
    const created = await scim("POST", "/Users", body);

    expect(created.status).toBe(400);
    expect(created.json["scimType"]).toBe("invalidValue");
    expect(JSON.stringify(created.json)).not.toContain("im@example");
    expect(await db.selectFrom("user").select("id").execute()).toEqual([]);
    expect(await refusals()).toEqual([
      { action: "scim_user_created", reason_code: EMAIL_FOLD_ERROR },
    ]);
  });

  it("refuses a change to the KELVIN SIGN form and keeps the stored address", async () => {
    const created = await scim("POST", "/Users", userBody("d-3", "visser@example.test"));
    expect(created.status).toBe(201);
    const scimId = String(created.json["id"]);

    const patched = await scim("PATCH", `/Users/${scimId}`, {
      schemas: [PATCH_SCHEMA],
      Operations: [{ op: "replace", path: "emails", value: [{ value: KELVIN, primary: true }] }],
    });

    expect(patched.status).toBe(400);
    const stored = await db.selectFrom("user").select("email").execute();
    expect(stored).toEqual([{ email: "visser@example.test" }]);
    expect(await refusals()).toEqual([
      { action: "scim_user_updated", reason_code: EMAIL_FOLD_ERROR },
    ]);
  });

  // NOTE: the scim plugin 1.7.20 validates every address with `z.email()`, which takes no
  // non-ASCII address at all, so this one is the plugin's refusal and never a fold refusal.
  it("leaves an address that stays non-ASCII to the plugin's own check", async () => {
    const created = await scim("POST", "/Users", userBody("d-4", "José@school.example"));
    expect(created.status).toBe(400);
    expect(await refusals()).not.toContainEqual(
      expect.objectContaining({ reason_code: EMAIL_FOLD_ERROR }),
    );
  });
});
