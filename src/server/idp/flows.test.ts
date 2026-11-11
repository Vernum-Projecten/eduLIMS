// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { parseEnv } from "../env.ts";
import { AuthError } from "../middleware.ts";
// The runtime flows around the identity providers (#46): the admin-only service context, the
// test sign-in, RP-initiated logout, and the refusal of a disabled provider's callback.
import { createTestAuth } from "../test-auth.ts";
import { VALID_ENV } from "../test-env.ts";
import { openIdToken, withoutPlainTokens } from "./account-tokens.ts";
import { adminServiceContext } from "./context.ts";
import { isEnvelope, keyringOf } from "./crypto.ts";
import { endSessionUrl, logoutUrlFor } from "./logout.ts";
import { providerUrls } from "./provider-config.ts";
import { invalidateProviderCache } from "./registry.ts";
import {
  bindTestState,
  readTestOutcome,
  recordTestOutcome,
  startTest,
  stateOfRedirect,
  testIdOfCallback,
  testOfState,
} from "./test-flow.ts";
import { insertTestProvider } from "./test-providers.ts";

const ENV = parseEnv(VALID_ENV);
/** A database the context only holds: it never connects. */
const UNUSED_DB = new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool({ max: 1 }) }) });
const NOW = new Date("2026-11-11T12:00:00Z");
let db: Kysely<DB> | undefined;

afterEach(async () => {
  invalidateProviderCache();
  await db?.destroy();
  db = undefined;
});

describe("adminServiceContext (B1, R-01)", () => {
  it.each([[["student"]], [["teacher"]], [[]]] as const)(
    "refuses a caller with the roles %j with 403",
    (roles) => {
      expect(() => adminServiceContext({ id: "u1", roles: [...roles] }, ENV, UNUSED_DB)).toThrow(
        AuthError,
      );
    },
  );

  it("gives an administrator and a teacher-admin a context that acts as them", () => {
    for (const roles of [["admin"], ["teacher", "admin"]] as const) {
      const ctx = adminServiceContext({ id: "a1", roles: [...roles] }, ENV, UNUSED_DB);
      expect(ctx.actor).toEqual({ type: "user", id: "a1" });
      expect(ctx.policy).toEqual({ production: false, privateOrigins: ["http://localhost:8180"] });
    }
  });
});

describe("provider URLs", () => {
  it("names the callback, ACS, SP entity and post-logout URLs under BETTER_AUTH_URL", () => {
    expect(providerUrls("https://edulims.example/", "entra")).toEqual({
      redirectUri: "https://edulims.example/api/auth/sso/callback/entra",
      postLogoutRedirectUri: "https://edulims.example/login",
      acsUrl: "https://edulims.example/api/auth/sso/saml2/sp/acs/entra",
      spEntityId: "https://edulims.example/api/auth/sso/saml2/sp/metadata?providerId=entra",
      spMetadataUrl: "https://edulims.example/api/auth/sso/saml2/sp/metadata?providerId=entra",
    });
  });
});

describe("the test sign-in", () => {
  it("reads the test id of a test-result callback URL only", () => {
    const test = "a".repeat(32);
    expect(
      testIdOfCallback(`/admin/system/identity-providers/entra/test-result?test=${test}`),
    ).toEqual({ providerId: "entra", test });
    expect(testIdOfCallback(`/login?test=${test}`)).toBeNull();
    expect(
      testIdOfCallback("/admin/system/identity-providers/entra/test-result?test=x"),
    ).toBeNull();
    expect(testIdOfCallback(42)).toBeNull();
  });

  it("reads the OAuth state or SAML RelayState of a redirect", () => {
    expect(stateOfRedirect("https://idp.example/authorize?state=s1")).toBe("s1");
    expect(stateOfRedirect("https://idp.example/saml?RelayState=r1")).toBe("r1");
    expect(stateOfRedirect("not a url")).toBeNull();
  });

  it("binds a state to the administrator's own test and records the outcome for them only", async () => {
    db = await createTestDb();
    await insertTestProvider(db, keyringOf(ENV), { providerId: "entra", enabled: false });
    const test = await startTest(db, { adminId: "admin-1", providerId: "entra", now: NOW });
    expect(test).toMatch(/^[A-Za-z0-9_-]{32}$/);
    await bindTestState(db, { adminId: "other", providerId: "entra", test, state: "x", now: NOW });
    expect(await testOfState(db, { state: "x", providerId: "entra", now: NOW })).toBeNull();
    await bindTestState(db, {
      adminId: "admin-1",
      providerId: "entra",
      test,
      state: "s",
      now: NOW,
    });
    expect(await testOfState(db, { state: "s", providerId: "keycloak", now: NOW })).toBeNull();
    expect(await testOfState(db, { state: "s", providerId: "entra", now: NOW })).toBe(test);
    const read = (adminId: string) =>
      readTestOutcome(db as Kysely<DB>, { test, adminId, providerId: "entra", now: NOW });
    expect(await read("admin-1")).toEqual({ done: false });
    const outcome = { outcome: "idp", roles: ["teacher"], claimNames: ["email", "roles", "sub"] };
    await recordTestOutcome(db, { test, outcome, now: NOW });
    expect(await read("admin-1")).toEqual({ done: true, outcome });
    expect(await read("someone-else")).toBeNull();
    const later = new Date(NOW.getTime() + 11 * 60 * 1000);
    expect(
      await readTestOutcome(db, { test, adminId: "admin-1", providerId: "entra", now: later }),
    ).toBeNull();
    const logged = await db
      .selectFrom("audit_event")
      .select(["action", "actor_id", "metadata"])
      .execute();
    expect(logged).toEqual([
      {
        action: "idp_tested",
        actor_id: "admin-1",
        metadata: { provider_id: "entra", test_outcome: "idp" },
      },
    ]);
  });
});

describe("RP-initiated logout (OpenID Connect RP-Initiated Logout 1.0 §2)", () => {
  it("builds the end-session URL with the ID token hint, the client and the return URL", () => {
    const url = new URL(
      endSessionUrl({
        endSessionEndpoint: "https://idp.example/logout?x=1",
        idToken: "id.token.value",
        clientId: "client-1",
        postLogoutRedirectUri: "https://edulims.example/login",
      }),
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      x: "1",
      id_token_hint: "id.token.value",
      client_id: "client-1",
      post_logout_redirect_uri: "https://edulims.example/login",
    });
  });

  it("finds the user's latest OIDC sign-in with an end-session endpoint", async () => {
    db = await createTestDb();
    await insertTestProvider(db, keyringOf(ENV), {
      providerId: "entra",
      endSessionEndpoint: "https://idp.example.test/logout",
    });
    await insertTestProvider(db, keyringOf(ENV), { providerId: "plain" });
    const now = new Date();
    await db
      .insertInto("user")
      .values({ id: "u1", name: "U", email: "u@example.test", emailVerified: true })
      .execute();
    const keyring = keyringOf(ENV);
    expect(
      await logoutUrlFor(db, { userId: "u1", baseURL: "https://edulims.example", keyring }),
    ).toBeNull();
    await db
      .insertInto("account")
      .values({
        id: "a1",
        accountId: "sub",
        providerId: "entra",
        userId: "u1",
        idToken: withoutPlainTokens(keyring, { idToken: "id-token" }).idToken,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    const url = await logoutUrlFor(db, {
      userId: "u1",
      baseURL: "https://edulims.example",
      keyring,
    });
    expect(url).toBe(
      "https://idp.example.test/logout?id_token_hint=id-token&client_id=entra-client&post_logout_redirect_uri=https%3A%2F%2Fedulims.example%2Flogin",
    );
  });

  it("returns the end-session URL from /sign-out, after ending the eduLIMS session", async () => {
    db = await createTestDb();
    await insertTestProvider(db, keyringOf(ENV), {
      providerId: "entra",
      endSessionEndpoint: "https://idp.example.test/logout",
    });
    const auth = await createTestAuth(ENV, { db, type: "postgres" });
    const { user } = await auth.api.createUser({
      body: { email: "t@example.test", name: "T", password: "correct-horse", role: "teacher" },
    });
    const now = new Date();
    await db
      .insertInto("account")
      .values({
        id: "a2",
        accountId: "sub",
        providerId: "entra",
        userId: user.id,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    const signIn = await auth.api.signInEmail({
      body: { email: "t@example.test", password: "correct-horse" },
      asResponse: true,
    });
    const cookie = signIn.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const response = await auth.handler(
      new Request(`${VALID_ENV.BETTER_AUTH_URL}/api/auth/sign-out`, {
        method: "POST",
        headers: { cookie, origin: VALID_ENV.BETTER_AUTH_URL, "content-type": "application/json" },
        body: JSON.stringify({ disableRedirect: true }),
      }),
    );
    const body: unknown = await response.json();
    expect(body).toMatchObject({ success: true, redirect: false });
    expect(String(Reflect.get(Object(body), "url"))).toMatch(
      /^https:\/\/idp\.example\.test\/logout\?client_id=entra-client&post_logout_redirect_uri=/,
    );
    expect(await db.selectFrom("session").select("id").execute()).toEqual([]);
  });

  it("sends a disabled provider's callback back to the login page", async () => {
    db = await createTestDb();
    await insertTestProvider(db, keyringOf(ENV), { providerId: "entra", enabled: false });
    const auth = await createTestAuth(ENV, { db, type: "postgres" });
    const response = await auth.handler(
      new Request(`${VALID_ENV.BETTER_AUTH_URL}/api/auth/sso/callback/entra?code=x&state=y`),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      `${VALID_ENV.BETTER_AUTH_URL}/login?error=provider_disabled`,
    );
  });
});

describe("tokens at rest (#46, ADR 0015)", () => {
  it("drops the access and refresh tokens and seals the ID token", () => {
    const keyring = keyringOf(ENV);
    const stored = withoutPlainTokens(keyring, {
      accessToken: "access",
      refreshToken: "refresh",
      idToken: "header.payload.signature",
      providerId: "entra",
    });
    expect(stored.accessToken).toBeNull();
    expect(stored.refreshToken).toBeNull();
    expect(isEnvelope(stored.idToken)).toBe(true);
    expect(stored.providerId).toBe("entra");
    expect(openIdToken(keyring, stored.idToken)).toBe("header.payload.signature");
  });

  it("keeps no ID token without a data key, and opens no plaintext one", () => {
    const stored = withoutPlainTokens({ current: null, previous: null }, { idToken: "x" });
    expect(stored.idToken).toBeNull();
    expect(openIdToken(keyringOf(ENV), "plain.id.token")).toBeNull();
    expect(openIdToken(keyringOf(ENV), null)).toBeNull();
  });

  it("leaves a write without tokens (a dev-login password) as it is", () => {
    expect(withoutPlainTokens(keyringOf(ENV), { password: "hash" })).toEqual({ password: "hash" });
  });
});
