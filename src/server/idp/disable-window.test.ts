// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The provider-disable window (#92 M-1, ASVS V7.4.2): each process caches provider settings for
// 30 seconds, so a provider disabled by another process (the host CLI, a second app instance)
// still looks enabled here. The sign-in gate and the session read go past that cache. A real
// OIDC callback runs through better-auth and the sso plugin with the IdP stubbed at the HTTP
// layer; the provider is disabled with a plain UPDATE, which no cache hears about.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { PROVIDER_DISABLED_ERROR } from "../../lib/identity-providers.ts";
import type { Auth } from "../auth.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { parseEnv } from "../env.ts";
import { resolveSessionUser } from "../session.ts";
import { createTestAuth } from "../test-auth.ts";
import { VALID_ENV } from "../test-env.ts";
import { keyringOf } from "./crypto.ts";
import { invalidateProviderCache, providerEnabled, providerSettings } from "./registry.ts";
import { stubIdp } from "./test-oidc.ts";
import { insertTestProvider } from "./test-providers.ts";

const BASE = VALID_ENV.BETTER_AUTH_URL;
const ISSUER = "https://entra.example.test/tenant/v2.0";
let db: Kysely<DB> | undefined;

afterEach(async () => {
  vi.unstubAllGlobals();
  invalidateProviderCache();
  await db?.destroy();
  db = undefined;
});

async function setup() {
  db = await createTestDb();
  const env = parseEnv(VALID_ENV);
  await insertTestProvider(db, keyringOf(env), { providerId: "entra", issuer: ISSUER });
  const auth = await createTestAuth(env, { db, type: "postgres" });
  const idp = stubIdp(ISSUER, "entra-client");
  idp.claims = {
    sub: "entra-subject",
    email: "window@example.test",
    name: "Window Teacher",
    roles: ["edulims-teacher"],
  };
  vi.stubGlobal("fetch", idp.fetch);
  return { auth, database: db, idp };
}

function cookiesOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}

/** Starts a sign-in through `entra`; the start reads (and caches) the provider as enabled. */
async function startSignIn(auth: Auth) {
  const start = await auth.handler(
    new Request(`${BASE}/api/auth/sign-in/sso`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE },
      body: JSON.stringify({ providerId: "entra", callbackURL: "/", errorCallbackURL: "/login" }),
    }),
  );
  const { url } = z.object({ url: z.url() }).parse(await start.json());
  return { state: new URL(url).searchParams.get("state"), cookie: cookiesOf(start) };
}

async function callback(auth: Auth, started: { state: string | null; cookie: string }) {
  return auth.handler(
    new Request(`${BASE}/api/auth/sso/callback/entra?code=entra-code&state=${started.state}`, {
      headers: { cookie: started.cookie },
    }),
  );
}

/** Disables `entra` the way another process does: in the database, with no cache invalidated. */
async function disableElsewhere(database: Kysely<DB>): Promise<void> {
  await database
    .updateTable("identity_provider")
    .set({ enabled: false })
    .where("provider_id", "=", "entra")
    .execute();
}

describe("a provider disabled in another process (M-1)", () => {
  it("refuses a callback within the cache window, and mints no session", async () => {
    const { auth, database } = await setup();
    const started = await startSignIn(auth);
    await disableElsewhere(database);
    // This process still has the provider cached as enabled.
    expect((await providerSettings(database, "entra"))?.enabled).toBe(true);

    const response = await callback(auth, started);

    const location = new URL(response.headers.get("location") ?? "", BASE);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("error")).toBe(PROVIDER_DISABLED_ERROR);
    expect(await database.selectFrom("session").select("id").execute()).toEqual([]);
    expect(await database.selectFrom("user").select("id").execute()).toEqual([]);
  });

  it("resolves an existing session through that provider to no user, and ends it", async () => {
    const { auth, database } = await setup();
    const signedIn = await callback(auth, await startSignIn(auth));
    const headers = new Headers({ cookie: cookiesOf(signedIn) });
    const enabled = (providerId: string) => providerEnabled(database, providerId);
    expect(await resolveSessionUser(auth, headers, new Date(), enabled)).toMatchObject({
      roles: ["teacher"],
    });

    await disableElsewhere(database);

    expect(await resolveSessionUser(auth, headers, new Date(), enabled)).toBeNull();
    expect(await database.selectFrom("session").select("id").execute()).toEqual([]);
  });

  it("leaves a development-login session alone", async () => {
    const { auth } = await setup();
    await auth.api.createUser({
      body: { email: "dev@example.test", name: "Dev", password: "dev-password-1", role: "teacher" },
    });
    const response = await auth.api.signInEmail({
      body: { email: "dev@example.test", password: "dev-password-1" },
      asResponse: true,
    });
    const never = vi.fn(async () => false);
    const headers = new Headers({ cookie: cookiesOf(response) });
    expect(await resolveSessionUser(auth, headers, new Date(), never)).not.toBeNull();
    expect(never).not.toHaveBeenCalled();
  });
});

describe("providerEnabled", () => {
  it("reads the database every time, and is false for an unknown or malformed id", async () => {
    const { database } = await setup();
    expect(await providerEnabled(database, "entra")).toBe(true);
    await disableElsewhere(database);
    expect(await providerEnabled(database, "entra")).toBe(false);
    expect(await providerEnabled(database, "nowhere")).toBe(false);
    expect(await providerEnabled(database, "Not A Slug")).toBe(false);
  });
});
