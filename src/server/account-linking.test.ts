// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ACCOUNT_NOT_LINKED_ERROR, normalizeSignInError } from "../lib/identity-providers.ts";
// Cross-provider account linking is off (#39, ASVS V6.8.1) for SSO providers too (ADR 0015).
// These tests run a real SSO OIDC callback through better-auth and the sso plugin, with the
// provider's token and JWKS endpoints stubbed at the HTTP layer (a signed ID token), against a
// user who already signs in through another provider.
import type { Auth } from "./auth.ts";
import type { DB } from "./db/schema.gen.ts";
import { createTestDb } from "./db/test-db.ts";
import { parseEnv } from "./env.ts";
import { keyringOf } from "./idp/crypto.ts";
import { type StubIdp, stubIdp } from "./idp/test-oidc.ts";
import { insertTestProvider } from "./idp/test-providers.ts";
import { createTestAuth } from "./test-auth.ts";
import { VALID_ENV } from "./test-env.ts";

const BASE = VALID_ENV.BETTER_AUTH_URL;
const ISSUER = "https://entra.example.test/tenant/v2.0";
const EMAIL = "teacher@example.test";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  vi.unstubAllGlobals();
  await db?.destroy();
  db = undefined;
});

async function setup() {
  db = await createTestDb();
  const env = parseEnv(VALID_ENV);
  await insertTestProvider(db, keyringOf(env), { providerId: "entra", issuer: ISSUER });
  await insertTestProvider(db, keyringOf(env), {
    providerId: "keycloak",
    issuer: "https://keycloak.example.test/realms/edulims",
  });
  const auth = await createTestAuth(env, { db, type: "postgres" });
  const idp = stubIdp(ISSUER, "entra-client");
  vi.stubGlobal("fetch", idp.fetch);
  return { auth, database: db, idp };
}

/** Creates a user who signs in through the `keycloak` provider, with that account row only. */
async function keycloakUser(database: Kysely<DB>): Promise<string> {
  const now = new Date();
  const id = "kc-user-1";
  await database
    .insertInto("user")
    .values({
      id,
      name: "Test Teacher",
      email: EMAIL,
      emailVerified: true,
      role: "teacher",
      role_source: "keycloak",
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  await database
    .insertInto("account")
    .values({
      id: "kc-account-1",
      accountId: "keycloak-subject",
      providerId: "keycloak",
      userId: id,
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  return id;
}

/** Starts an SSO sign-in through `entra` and completes its callback; returns the redirect. */
async function signInWithEntra(
  auth: Auth,
  idp: StubIdp,
  email: string,
  extra: Record<string, unknown> = {},
) {
  idp.claims = {
    sub: "entra-subject",
    email,
    name: "Test Teacher",
    roles: ["edulims-teacher"],
    ...extra,
  };
  const start = await auth.handler(
    new Request(`${BASE}/api/auth/sign-in/sso`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE },
      body: JSON.stringify({ providerId: "entra", callbackURL: "/", errorCallbackURL: "/login" }),
    }),
  );
  const { url } = z.object({ url: z.url() }).parse(await start.json());
  const authorize = new URL(url);
  expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
  expect(authorize.searchParams.get("scope")).toBe("openid email profile");
  const state = authorize.searchParams.get("state");
  const cookie = start.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const callback = await auth.handler(
    new Request(`${BASE}/api/auth/sso/callback/entra?code=entra-code&state=${state}`, {
      headers: { cookie },
    }),
  );
  return {
    location: callback.headers.get("location") ?? "",
    setCookies: callback.headers.getSetCookie(),
  };
}

describe("cross-provider account linking (#39, ASVS V6.8.1)", () => {
  it("refuses an SSO sign-in with the email of a user of another provider", async () => {
    const { auth, database, idp } = await setup();
    const userId = await keycloakUser(database);

    const { location, setCookies } = await signInWithEntra(auth, idp, EMAIL);

    expect(new URL(location, BASE).pathname).toBe("/login");
    const error = new URL(location, BASE).searchParams.get("error") ?? "";
    expect(normalizeSignInError(error)).toBe(ACCOUNT_NOT_LINKED_ERROR);
    expect(setCookies.filter((cookie) => /session_token=[^;]/.test(cookie))).toEqual([]);
    const accounts = await database
      .selectFrom("account")
      .select("providerId")
      .where("userId", "=", userId)
      .execute();
    expect(accounts).toEqual([{ providerId: "keycloak" }]);
    const sessions = await database.selectFrom("session").select("id").execute();
    expect(sessions).toEqual([]);
  });

  it("still signs in a new user, so the refusal above is not a broken stub", async () => {
    const { auth, database, idp } = await setup();

    const { location } = await signInWithEntra(auth, idp, "new-teacher@example.test");

    expect(new URL(location, BASE).searchParams.get("error")).toBeNull();
    const user = await database
      .selectFrom("user")
      .select(["role", "role_source"])
      .where("email", "=", "new-teacher@example.test")
      .executeTakeFirst();
    expect(user).toEqual({ role: "teacher", role_source: "entra" });
    const account = await database
      .selectFrom("account")
      .select(["accountId", "accessToken", "refreshToken", "idToken"])
      .where("providerId", "=", "entra")
      .executeTakeFirstOrThrow();
    // Accounts are keyed by the verified ID token's subject (V10.5.2), never the email.
    expect(account.accountId).toBe("entra-subject");
    // No plaintext token at rest (ADR 0015): no access or refresh token, the ID token sealed.
    expect(account.accessToken).toBeNull();
    expect(account.refreshToken).toBeNull();
    expect(account.idToken).toMatch(/^enc:v1:/);
    expect(JSON.stringify(account)).not.toContain("stub-access-token");
  });
});

describe("ID token validation of an SSO provider (V10.5.3, V10.5.4, V6.8.2)", () => {
  it.each([
    ["another audience", { aud: "someone-elses-client" }],
    ["another issuer", { iss: "https://evil.example.test/tenant/v2.0" }],
    ["an expired token", { exp: Math.floor(Date.now() / 1000) - 600 }],
  ])("refuses an ID token for %s and starts no session", async (_case, claims) => {
    const { auth, database, idp } = await setup();
    const { location, setCookies } = await signInWithEntra(auth, idp, "x@example.test", claims);
    expect(new URL(location, BASE).searchParams.get("error")).toBe("invalid_provider");
    expect(setCookies.filter((cookie) => /session_token=[^;]/.test(cookie))).toEqual([]);
    expect(await database.selectFrom("user").select("id").execute()).toEqual([]);
  });
});
