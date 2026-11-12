// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { keyringOf } from "../idp/crypto.ts";
import { insertTestProvider } from "../idp/test-providers.ts";
import { AuthError } from "../middleware.ts";
import { VALID_ENV } from "../test-env.ts";
import { enabledProviderSettings, readSystemConfiguration } from "./queries.ts";

const BASE_URL = "https://edulims.example.test";
const keyring = keyringOf({ EDULIMS_DATA_KEY: VALID_ENV.EDULIMS_DATA_KEY });

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function withProviders(): Promise<Kysely<DB>> {
  db = await createTestDb();
  await insertTestProvider(db, keyring, {
    providerId: "campus",
    labelEn: "Campus account",
    labelNl: "Campusaccount",
    roleClaim: "realm_access.roles",
    roleMap: { "lab-teacher": "teacher", "lab-admin": "admin", "lab-student": "student" },
    defaultRole: "student",
  });
  await insertTestProvider(db, keyring, {
    providerId: "campus-saml",
    protocol: "saml",
    roleClaim: "Role",
    roleMap: {},
    baseURL: BASE_URL,
  });
  await insertTestProvider(db, keyring, { providerId: "retired-idp", enabled: false });
  return db;
}

describe("enabledProviderSettings (#36)", () => {
  it("lists only the enabled providers", async () => {
    const providers = await enabledProviderSettings(await withProviders(), BASE_URL, "en");
    const ids = providers.map((provider) => provider.providerId);
    expect(ids).toContain("campus");
    expect(ids).toContain("campus-saml");
    expect(ids).not.toContain("retired-idp");
  });

  it("gives an OIDC provider its redirect URI and its role settings, the map sorted", async () => {
    const providers = await enabledProviderSettings(await withProviders(), BASE_URL, "nl");
    expect(providers.find((provider) => provider.providerId === "campus")).toEqual({
      providerId: "campus",
      label: "Campusaccount",
      protocol: "oidc",
      callbackUrl: `${BASE_URL}/api/auth/sso/callback/campus`,
      roleClaim: "realm_access.roles",
      roleMap: [
        { value: "lab-admin", role: "admin" },
        { value: "lab-student", role: "student" },
        { value: "lab-teacher", role: "teacher" },
      ],
      defaultRole: "student",
    });
  });

  it("gives a SAML provider its assertion consumer service URL", async () => {
    const providers = await enabledProviderSettings(await withProviders(), BASE_URL, "en");
    const saml = providers.find((provider) => provider.providerId === "campus-saml");
    expect(saml?.callbackUrl).toBe(`${BASE_URL}/api/auth/sso/saml2/sp/acs/campus-saml`);
    expect(saml?.roleMap).toEqual([]);
    expect(saml?.defaultRole).toBeNull();
  });
});

describe("readSystemConfiguration (#36)", () => {
  it.each([
    ["a student", ["student"]],
    ["a teacher", ["teacher"]],
    ["a user without a role", []],
  ] as const)("refuses %s with 403", async (_name, roles) => {
    const database = await withProviders();
    const error: unknown = await readSystemConfiguration({
      db: database,
      actor: { roles: [...roles] },
      baseURL: BASE_URL,
      locale: "en",
      buildEnv: {},
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({ status: 403 });
  });

  it("answers an administrator with the providers and the build", async () => {
    const config = await readSystemConfiguration({
      db: await withProviders(),
      actor: { roles: ["admin"] },
      baseURL: BASE_URL,
      locale: "en",
      buildEnv: { EDULIMS_BUILD_VERSION: "1.0.0" },
    });
    expect(config.build.version).toBe("1.0.0");
    expect(config.providers.length).toBeGreaterThanOrEqual(2);
  });
});
