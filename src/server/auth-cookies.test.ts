// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { authCookieOptions } from "./auth.ts";
import type { DB } from "./db/schema.gen.ts";
import { createTestDb } from "./db/test-db.ts";
import { parseEnv } from "./env.ts";
import { keyringOf } from "./idp/crypto.ts";
import { insertTestProvider } from "./idp/test-providers.ts";
// The `__Host-` prefix on every cookie eduLIMS sets over https (#43, ASVS V3.3.3), read from
// the Set-Cookie headers of a real sign-in.
import { createTestAuth } from "./test-auth.ts";
import { VALID_ENV } from "./test-env.ts";

const PASSWORD = "correct-horse-battery";
const EMAIL = "student@example.test";
let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

/** Signs a dev user with a saved locale in against `baseURL`; returns the Set-Cookie headers. */
async function signInCookies(baseURL: string): Promise<string[]> {
  const database = await createTestDb();
  db = database;
  const auth = await createTestAuth(parseEnv({ ...VALID_ENV, BETTER_AUTH_URL: baseURL }), {
    db: database,
    type: "postgres",
  });
  await auth.api.createUser({ body: { email: EMAIL, name: "Test Student", password: PASSWORD } });
  await database.updateTable("user").set({ locale: "nl" }).where("email", "=", EMAIL).execute();
  const response = await auth.api.signInEmail({
    body: { email: EMAIL, password: PASSWORD },
    asResponse: true,
  });
  expect(response.status).toBe(200);
  return response.headers.getSetCookie();
}

function named(cookies: string[], name: string): string | undefined {
  return cookies.find((cookie) => cookie.startsWith(`${name}=`));
}

describe("cookies over https (#43, ASVS V3.3.3)", () => {
  it("names the session cookie __Host- with Secure, HttpOnly, Path=/ and no Domain", async () => {
    const cookies = await signInCookies("https://edulims.example");
    const session = named(cookies, "__Host-better-auth.session_token");
    expect(session).toBeDefined();
    expect(session).toMatch(/;\s*Secure/i);
    expect(session).toMatch(/;\s*HttpOnly/i);
    expect(session).toMatch(/;\s*Path=\/(;|$)/i);
    expect(session).toMatch(/;\s*SameSite=Lax/i);
    expect(session).not.toMatch(/;\s*Domain=/i);
  });

  it("sets every cookie of the sign-in with the __Host- prefix and its rules", async () => {
    const cookies = await signInCookies("https://edulims.example");
    expect(cookies.length).toBeGreaterThan(0);
    for (const cookie of cookies) {
      expect(cookie).toMatch(/^__Host-/);
      expect(cookie).toMatch(/;\s*Secure/i);
      expect(cookie).toMatch(/;\s*Path=\/(;|$)/i);
      expect(cookie).not.toMatch(/;\s*Domain=/i);
    }
  });

  it("prefixes the OAuth state cookie of an identity provider sign-in too", async () => {
    db = await createTestDb();
    await insertTestProvider(db, keyringOf(parseEnv(VALID_ENV)), { providerId: "entra" });
    const base = "https://edulims.example";
    const auth = await createTestAuth(parseEnv({ ...VALID_ENV, BETTER_AUTH_URL: base }), {
      db,
      type: "postgres",
    });
    const response = await auth.handler(
      new Request(`${base}/api/auth/sign-in/sso`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: base },
        body: JSON.stringify({ providerId: "entra", callbackURL: "/" }),
      }),
    );
    const cookies = response.headers.getSetCookie();
    expect(cookies.length).toBeGreaterThan(0);
    for (const cookie of cookies)
      expect(cookie).toMatch(/^__Host-better-auth\.[^=]+=.*;\s*Secure/i);
  });

  it("names the locale cookie __Host-EDULIMS_LOCALE, readable by the language menu", async () => {
    const locale = named(await signInCookies("https://edulims.example"), "__Host-EDULIMS_LOCALE");
    expect(locale).toMatch(/^__Host-EDULIMS_LOCALE=nl;/);
    expect(locale).toMatch(/;\s*Secure/i);
    expect(locale).not.toMatch(/HttpOnly/i);
  });
});

describe("cookies over plain http (development)", () => {
  it("keeps the unprefixed names, which a browser accepts without Secure", async () => {
    const cookies = await signInCookies("http://localhost:3000");
    expect(named(cookies, "better-auth.session_token")).toBeDefined();
    expect(named(cookies, "EDULIMS_LOCALE")).toMatch(/^EDULIMS_LOCALE=nl;/);
    expect(cookies.filter((cookie) => cookie.startsWith("__Host-"))).toEqual([]);
  });

  it("adds no cookie options for an http base URL", () => {
    expect(authCookieOptions("http://localhost:3000")).toEqual({});
  });
});
