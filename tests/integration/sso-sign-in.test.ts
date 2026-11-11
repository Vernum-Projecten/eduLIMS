// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Auth } from "../../src/server/auth.ts";
import type { DB } from "../../src/server/db/schema.gen.ts";
import { devKeycloakRealm, seedDevProviders } from "../../src/server/db/seed-providers.ts";
import { createTestDb } from "../../src/server/db/test-db.ts";
import { parseEnv } from "../../src/server/env.ts";
import { keyringOf } from "../../src/server/idp/crypto.ts";
// Real SSO sign-ins through identity providers registered at runtime (#46, ADR 0012, ADR 0015):
// the admin service registers the development Keycloak (docker/keycloak/edulims-realm.json) as
// `keycloak` (OIDC) and `keycloak-saml` (SAML), then each realm user signs in through eduLIMS's
// own better-auth handler and the stored role set or the refusal is checked. Skipped when that
// Keycloak is not reachable (CI); EDULIMS_IT_KEYCLOAK_REALM points it at another realm URL.
import { createTestAuth } from "../../src/server/test-auth.ts";
import { VALID_ENV } from "../../src/server/test-env.ts";
import {
  CookieJar,
  formAction,
  hiddenInputs,
  keycloakLogin,
  keycloakReachable,
} from "./sso-flow.ts";

const BASE = "http://localhost:3000";
const REALM = process.env["EDULIMS_IT_KEYCLOAK_REALM"]?.trim() || devKeycloakRealm();

const ready = await keycloakReachable(REALM);
if (!ready) {
  console.warn(
    `SSO sign-in test skipped: no Keycloak realm at ${REALM}. ` +
      "Start it with pnpm dev:db (recreate the container to import the realm).",
  );
}

/** Where eduLIMS sent the browser at the end of a sign-in, and the error code if any. */
interface Outcome {
  path: string;
  error: string | null;
  signedIn: boolean;
}

describe.skipIf(!ready)("SSO sign-in through runtime providers (ADR 0015)", () => {
  let db: Kysely<DB>;
  let auth: Auth;

  beforeAll(async () => {
    db = await createTestDb();
    // The realm may run on another port (EDULIMS_DEV_KEYCLOAK_PORT): allow exactly its origin.
    const env = parseEnv({
      ...VALID_ENV,
      BETTER_AUTH_URL: BASE,
      EDULIMS_IDP_PRIVATE_ORIGINS: new URL(REALM).origin,
    });
    auth = await createTestAuth(env, { db, type: "postgres" });
    const lines = await seedDevProviders(
      db,
      {
        db,
        keyring: keyringOf(env),
        policy: { production: false, privateOrigins: env.EDULIMS_IDP_PRIVATE_ORIGINS },
        baseURL: BASE,
        actor: { type: "system" },
      },
      REALM,
    );
    expect(lines).toEqual([
      "created provider keycloak (enabled)",
      "created provider keycloak-saml (enabled)",
    ]);
  });

  afterAll(async () => {
    await db?.destroy();
  });

  async function start(providerId: string, jar: CookieJar): Promise<string> {
    const response = await auth.handler(
      new Request(`${BASE}/api/auth/sign-in/sso`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE },
        body: JSON.stringify({ providerId, callbackURL: "/login", errorCallbackURL: "/login" }),
      }),
    );
    jar.store(response);
    const body: unknown = await response.json();
    const url: unknown = Reflect.get(Object(body), "url");
    if (typeof url !== "string") throw new Error(`no sign-in URL (${response.status})`);
    return url;
  }

  function outcome(response: Response, jar: CookieJar): Outcome {
    jar.store(response);
    const location = new URL(response.headers.get("location") ?? "/", BASE);
    return {
      path: location.pathname,
      error: location.searchParams.get("error"),
      signedIn: jar.has("session_token"),
    };
  }

  async function signInOidc(username: string): Promise<Outcome> {
    const jar = new CookieJar();
    const keycloak = await keycloakLogin(await start("keycloak", jar), username);
    const callback = keycloak.headers.get("location");
    if (!callback?.startsWith(`${BASE}/api/auth/sso/callback/keycloak`)) {
      throw new Error(`Keycloak did not return to eduLIMS (${keycloak.status})`);
    }
    return outcome(
      await auth.handler(new Request(callback, { headers: { cookie: jar.header() } })),
      jar,
    );
  }

  async function signInSaml(username: string): Promise<Outcome> {
    const jar = new CookieJar();
    const keycloak = await keycloakLogin(await start("keycloak-saml", jar), username);
    const html = await keycloak.text();
    const action = formAction(html);
    if (!action?.startsWith(`${BASE}/api/auth/sso/saml2/sp/acs/keycloak-saml`)) {
      throw new Error(`Keycloak sent no SAML response (${keycloak.status})`);
    }
    return outcome(
      await auth.handler(
        new Request(action, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            cookie: jar.header(),
            origin: new URL(REALM).origin,
          },
          body: new URLSearchParams(hiddenInputs(html)),
        }),
      ),
      jar,
    );
  }

  async function storedUser(email: string) {
    return db
      .selectFrom("user")
      .select(["role", "role_source", "emailVerified"])
      .where("email", "=", email)
      .executeTakeFirst();
  }

  it.each([
    { user: "student", role: "student" },
    { user: "teacher", role: "teacher" },
    { user: "admin", role: "admin" },
    { user: "coordinator", role: "teacher,admin" },
    { user: "teacher-direct", role: "teacher" },
    { user: "mixed", role: "teacher,admin" },
  ])("OIDC: $user signs in with the role set $role from realm_access.roles", async (c) => {
    const result = await signInOidc(c.user);
    expect(result).toEqual({ path: "/login", error: null, signedIn: true });
    expect(await storedUser(`${c.user}@edulims.test`)).toEqual({
      role: c.role,
      role_source: "keycloak",
      emailVerified: true,
    });
  });

  it("OIDC: conflict (student and teacher) is refused with role_conflict (ADR 0012)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await signInOidc("conflict");
    vi.restoreAllMocks();
    expect(result).toEqual({ path: "/login", error: "role_conflict", signedIn: false });
    expect(await storedUser("conflict@edulims.test")).toBeUndefined();
  });

  it("OIDC: norole is refused with no_edulims_role", async () => {
    const result = await signInOidc("norole");
    expect(result).toEqual({ path: "/login", error: "no_edulims_role", signedIn: false });
  });

  it("SAML: the same email as an OIDC account is refused with account_not_linked (V6.8.1)", async () => {
    // coordinator already signed in through `keycloak`: linking is off (#39).
    const result = await signInSaml("coordinator");
    expect(result.signedIn).toBe(false);
    expect(result.error?.replaceAll(" ", "_")).toBe("account_not_linked");
  });

  it("SAML: teacher signs in with a persistent NameID and the teacher role", async () => {
    await db.deleteFrom("user").where("email", "=", "teacher@edulims.test").execute();
    const result = await signInSaml("teacher");
    expect(result).toEqual({ path: "/login", error: null, signedIn: true });
    expect(await storedUser("teacher@edulims.test")).toEqual({
      role: "teacher",
      role_source: "keycloak-saml",
      emailVerified: true,
    });
    const account = await db
      .selectFrom("account")
      .select(["providerId", "accountId"])
      .where("providerId", "=", "keycloak-saml")
      .executeTakeFirstOrThrow();
    // A persistent NameID is an opaque id, never the email address.
    expect(account.accountId).not.toContain("@");
  });

  it("SAML: conflict is refused with role_conflict", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await signInSaml("conflict");
    vi.restoreAllMocks();
    expect(result).toEqual({ path: "/login", error: "role_conflict", signedIn: false });
  });

  it("a disabled provider is refused at the start of the sign-in", async () => {
    await db
      .updateTable("identity_provider")
      .set({ enabled: false })
      .where("provider_id", "=", "keycloak")
      .execute();
    const { invalidateProviderCache } = await import("../../src/server/idp/registry.ts");
    invalidateProviderCache();
    const response = await auth.handler(
      new Request(`${BASE}/api/auth/sign-in/sso`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE },
        body: JSON.stringify({ providerId: "keycloak", callbackURL: "/login" }),
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "provider_disabled" });
  });
});
