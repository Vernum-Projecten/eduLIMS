// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { createAuth, identityProviders } from "./auth.ts";
import { parseRoles } from "./authz.ts";
import type { DB } from "./db/schema.gen.ts";
import { createTestDb } from "./db/test-db.ts";
import { parseEnv } from "./env.ts";
import { VALID_ENV } from "./test-env.ts";

const PASSWORD = "correct-horse-battery";
let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function setup(devLogin: boolean) {
  db = await createTestDb();
  const env = parseEnv({ ...VALID_ENV, EDULIMS_DEV_LOGIN: String(devLogin) });
  return createAuth(env, { db, type: "postgres" });
}

describe("auth", () => {
  it("gives new users the student role by default", async () => {
    const auth = await setup(true);
    const { user } = await auth.api.createUser({
      body: { email: "new@example.test", name: "Nieuw", password: PASSWORD },
    });
    expect(parseRoles(user.role)).toEqual(["student"]);
  });

  it("signs in dev users and resolves their session with roles", async () => {
    const auth = await setup(true);
    await auth.api.createUser({
      body: { email: "docent@example.test", name: "Dana", password: PASSWORD, role: "docent" },
    });
    const response = await auth.api.signInEmail({
      body: { email: "docent@example.test", password: PASSWORD },
      asResponse: true,
    });
    expect(response.status).toBe(200);
    const cookie = response.headers.getSetCookie().map((c) => c.split(";")[0]);
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: cookie.join("; ") }),
    });
    expect(session?.user.email).toBe("docent@example.test");
    expect(parseRoles(session?.user.role)).toEqual(["docent"]);
  });

  it("does not allow self sign-up, even with dev login on", async () => {
    const auth = await setup(true);
    await expect(
      auth.api.signUpEmail({ body: { email: "x@example.test", name: "X", password: PASSWORD } }),
    ).rejects.toThrow();
  });

  it("disables email/password sign-in when dev login is off", async () => {
    const auth = await setup(false);
    await auth.api.createUser({
      body: { email: "student@example.test", name: "Sam", password: PASSWORD },
    });
    await expect(
      auth.api.signInEmail({ body: { email: "student@example.test", password: PASSWORD } }),
    ).rejects.toThrow();
  });
});

describe("identityProviders", () => {
  const keycloak = {
    KEYCLOAK_ISSUER: "https://idp.example/realms/edulims",
    KEYCLOAK_CLIENT_ID: "edulims",
    KEYCLOAK_CLIENT_SECRET: "kc-secret",
  };

  it("lists one login button per configured provider", () => {
    const env = parseEnv({ ...VALID_ENV, ...keycloak, KEYCLOAK_LABEL: "Inloggen met Hanze-IdP" });
    expect(identityProviders(env)).toEqual([
      { id: "microsoft", label: "Inloggen met Hanze-account (Microsoft)" },
      { id: "keycloak", label: "Inloggen met Hanze-IdP" },
    ]);
  });

  it("lists nothing when no provider is configured", () => {
    const env = parseEnv({
      ...VALID_ENV,
      MICROSOFT_CLIENT_ID: undefined,
      MICROSOFT_CLIENT_SECRET: undefined,
      MICROSOFT_TENANT_ID: undefined,
    });
    expect(identityProviders(env)).toEqual([]);
  });

  it("registers Keycloak as an OAuth provider next to Microsoft", async () => {
    db = await createTestDb({ migrate: false });
    const auth = createAuth(parseEnv({ ...VALID_ENV, ...keycloak }), { db, type: "postgres" });
    const ids = auth.options.plugins.map((plugin) => plugin.id);
    expect(ids).toContain("generic-oauth");
    expect(Object.keys(auth.options.socialProviders)).toEqual(["microsoft"]);
  });
});
