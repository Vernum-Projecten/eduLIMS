// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Data-key rotation on a real PostgreSQL 18 (#46, ADR 0015; security review L4): `idp rekey`
// re-encrypts the provider secrets and the accounts' sealed ID tokens under the new key.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { openIdToken, sealAccountWrite } from "./account-tokens.ts";
import { DataKeyError, envelopeKid, keyringOf, openConfig } from "./crypto.ts";
import { invalidateProviderCache } from "./registry.ts";
import { rekeySecrets } from "./rekey.ts";
import { insertTestProvider } from "./test-providers.ts";

const OLD = Buffer.alloc(32, 1).toString("base64");
const NEW = Buffer.alloc(32, 2).toString("base64");
let db: Kysely<DB> | undefined;

afterEach(async () => {
  invalidateProviderCache();
  await db?.destroy();
  db = undefined;
});

async function setup() {
  db = await createTestDb();
  const old = keyringOf({ EDULIMS_DATA_KEY: OLD });
  await insertTestProvider(db, old, { providerId: "entra", clientSecret: "secret-1" });
  const now = new Date();
  await db
    .insertInto("user")
    .values({ id: "u1", name: "U", email: "u@example.test", emailVerified: true })
    .execute();
  await db
    .insertInto("account")
    .values({
      id: "a1",
      accountId: "sub",
      providerId: "entra",
      userId: "u1",
      idToken: sealAccountWrite(old, "a1", { idToken: "id-token-1" }).idToken,
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  return { database: db, old };
}

describe("rekeySecrets (L4, ASVS V11.1.1)", () => {
  it("re-encrypts provider secrets and ID tokens under the new key, bound to their rows", async () => {
    const { database } = await setup();
    const rotated = keyringOf({ EDULIMS_DATA_KEY: NEW, EDULIMS_DATA_KEY_PREVIOUS: OLD });
    expect(await rekeySecrets(database, rotated)).toEqual({ providers: 1, idTokens: 1 });
    const fresh = keyringOf({ EDULIMS_DATA_KEY: NEW });
    const account = await database
      .selectFrom("account")
      .select(["idToken"])
      .executeTakeFirstOrThrow();
    expect(envelopeKid(account.idToken)).toBe(fresh.current?.kid);
    expect(openIdToken(fresh, "a1", account.idToken)).toBe("id-token-1");
    const provider = await database
      .selectFrom("ssoProvider")
      .select(["oidcConfig"])
      .executeTakeFirstOrThrow();
    const config = openConfig(fresh, "entra", "oidcConfig", String(provider.oidcConfig));
    expect(JSON.parse(config)).toMatchObject({ clientSecret: "secret-1" });
  });

  it("writes nothing when a secret opens with neither key", async () => {
    const { database } = await setup();
    const before = await database.selectFrom("account").select("idToken").executeTakeFirst();
    const wrong = keyringOf({ EDULIMS_DATA_KEY: NEW });
    await expect(rekeySecrets(database, wrong)).rejects.toThrow(DataKeyError);
    const after = await database.selectFrom("account").select("idToken").executeTakeFirst();
    expect(after).toEqual(before);
  });
});
