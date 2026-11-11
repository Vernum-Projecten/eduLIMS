// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { type Auth, POST_LOGOUT_PATH } from "./auth.ts";
import { parseRoles } from "./authz.ts";
import type { DB } from "./db/schema.gen.ts";
import { createTestDb } from "./db/test-db.ts";
import { parseEnv } from "./env.ts";
import { createTestAuth } from "./test-auth.ts";
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
  return createTestAuth(env, { db, type: "postgres" });
}

describe("auth", () => {
  it("gives new users the student role by default", async () => {
    const auth = await setup(true);
    const { user } = await auth.api.createUser({
      body: { email: "new@example.test", name: "New User", password: PASSWORD },
    });
    expect(parseRoles(user.role)).toEqual(["student"]);
  });

  it("signs in dev users and resolves their session with roles", async () => {
    const auth = await setup(true);
    await auth.api.createUser({
      body: {
        email: "teacher@example.test",
        name: "Test Teacher",
        password: PASSWORD,
        role: "teacher",
      },
    });
    const response = await auth.api.signInEmail({
      body: { email: "teacher@example.test", password: PASSWORD },
      asResponse: true,
    });
    expect(response.status).toBe(200);
    const cookie = response.headers.getSetCookie().map((c) => c.split(";")[0]);
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: cookie.join("; ") }),
    });
    expect(session?.user.email).toBe("teacher@example.test");
    expect(parseRoles(session?.user.role)).toEqual(["teacher"]);
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
      body: { email: "student@example.test", name: "Test Student", password: PASSWORD },
    });
    await expect(
      auth.api.signInEmail({ body: { email: "student@example.test", password: PASSWORD } }),
    ).rejects.toThrow();
  });
});

const BASE = VALID_ENV.BETTER_AUTH_URL;

/** Signs a dev user with `role` in and returns the session cookie header. */
async function signedIn(auth: Auth, role: string): Promise<string> {
  const email = `${role}-sso@example.test`;
  await auth.api.createUser({
    body: {
      email,
      name: "SSO Test",
      password: PASSWORD,
      role: role === "admin" ? "admin" : "teacher",
    },
  });
  const response = await auth.api.signInEmail({
    body: { email, password: PASSWORD },
    asResponse: true,
  });
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

// One auth instance for the whole block, as the HTTP handler serves it.
describe("the sso plugin (ADR 0015)", () => {
  let ssoDb: Kysely<DB>;
  let auth: Auth;
  let adminCookie: string;

  beforeAll(async () => {
    ssoDb = await createTestDb();
    auth = await createTestAuth(parseEnv(VALID_ENV), { db: ssoDb, type: "postgres" });
    adminCookie = await signedIn(auth, "admin");
  });

  afterAll(async () => {
    await ssoDb?.destroy();
  });

  it("is set up with no provider registration, no organisations and strict SAML", () => {
    const plugin = auth.options.plugins.find((candidate) => candidate.id === "sso");
    expect(plugin?.options).toMatchObject({
      providersLimit: 0,
      organizationProvisioning: { disabled: true },
      saml: {
        requireTimestamps: true,
        algorithms: { onDeprecated: "reject" },
        enableInResponseToValidation: true,
        allowIdpInitiated: false,
        wantLogoutRequestSigned: true,
        wantLogoutResponseSigned: true,
      },
    });
    expect(plugin?.options).not.toHaveProperty("defaultSSO");
    expect(plugin?.options).not.toHaveProperty("trustEmailVerified");
    expect(plugin?.options).not.toHaveProperty("redirectURI");
    expect(plugin?.options).not.toHaveProperty("domainVerification");
    expect(auth.options.account?.accountLinking?.enabled).toBe(false);
  });

  it.each([
    ["POST", "/sso/register"],
    ["POST", "/sso/update-provider"],
    ["POST", "/sso/delete-provider"],
    ["GET", "/sso/providers"],
    ["GET", "/sso/get-provider?providerId=keycloak"],
    ["POST", "/sso/request-domain-verification"],
    ["POST", "/sso/verify-domain"],
    // #92 L1: SP-initiated SAML logout, which eduLIMS never uses.
    ["POST", "/sso/saml2/logout/keycloak-saml"],
  ])("answers %s %s with 404, even for an administrator", async (method, path) => {
    for (const headers of [{ cookie: adminCookie }, {}]) {
      const response = await auth.handler(
        new Request(`${BASE}/api/auth${path}`, {
          method,
          headers: { ...headers, origin: BASE, "content-type": "application/json" },
          ...(method === "POST"
            ? { body: JSON.stringify({ providerId: "x", issuer: "https://x" }) }
            : {}),
        }),
      );
      expect(response.status).toBe(404);
    }
  });

  it("refuses the management endpoints called on the server too (second lock)", async () => {
    await expect(auth.api.listSSOProviders({ headers: new Headers() })).rejects.toThrow();
  });

  it("refuses a sign-in that asks the plugin to route by email or to widen the scopes", async () => {
    for (const body of [
      { email: "someone@example.test", callbackURL: "/login" },
      { providerId: "keycloak", scopes: ["offline_access"], callbackURL: "/login" },
      { domain: "example.test", callbackURL: "/login" },
    ]) {
      const response = await auth.handler(
        new Request(`${BASE}/api/auth/sign-in/sso`, {
          method: "POST",
          headers: { origin: BASE, "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      expect(response.status).toBe(400);
    }
  });

  it("refuses a sign-in through an unknown provider as disabled", async () => {
    const response = await auth.handler(
      new Request(`${BASE}/api/auth/sign-in/sso`, {
        method: "POST",
        headers: { origin: BASE, "content-type": "application/json" },
        body: JSON.stringify({ providerId: "nowhere", callbackURL: "/login" }),
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "provider_disabled" });
  });

  it("trusts the app origin and the operator's private origins only, never an IdP issuer (M3b)", async () => {
    expect(auth.options.trustedOrigins).toEqual(["http://localhost:8180"]);
    const context = await auth.$context;
    expect(context.isTrustedOrigin(`${BASE}/teacher`)).toBe(true);
    expect(context.isTrustedOrigin("http://localhost:8180/realms/edulims")).toBe(true);
    expect(context.isTrustedOrigin("https://login.example.test/tenant/v2.0")).toBe(false);
  });

  it("sends the identity provider's logout back to the sign-in page", () => {
    expect(POST_LOGOUT_PATH).toBe("/login");
  });
});
