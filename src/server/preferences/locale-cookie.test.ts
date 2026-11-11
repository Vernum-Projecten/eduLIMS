// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { parseEnv } from "../env.ts";
import { createTestAuth } from "../test-auth.ts";
import { VALID_ENV } from "../test-env.ts";
import { savedLocale } from "./locale-cookie.ts";

const PASSWORD = "correct-horse-battery";
const EMAIL = "student@example.test";
let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

describe("savedLocale", () => {
  it.each([
    ["nl", "nl"],
    ["en", "en"],
    ["de", undefined],
    ["NL", undefined],
    [null, undefined],
    [undefined, undefined],
  ])("reads %j as %j", (value, expected) => {
    expect(savedLocale(value)).toBe(expected);
  });
});

/** Signs a user in after saving `locale` for them; returns the auth, the db and Set-Cookie. */
async function signInWithSavedLocale(locale: string | null) {
  const database = await createTestDb();
  db = database;
  const auth = await createTestAuth(parseEnv({ ...VALID_ENV, EDULIMS_DEV_LOGIN: "true" }), {
    db: database,
    type: "postgres",
  });
  await auth.api.createUser({ body: { email: EMAIL, name: "Test Student", password: PASSWORD } });
  await database.updateTable("user").set({ locale }).where("email", "=", EMAIL).execute();
  const response = await auth.api.signInEmail({
    body: { email: EMAIL, password: PASSWORD },
    asResponse: true,
  });
  expect(response.status).toBe(200);
  return { auth, database, cookies: response.headers.getSetCookie() };
}

describe("applying the saved locale on sign-in", () => {
  it("sets the locale cookie from the user's saved locale", async () => {
    const { cookies } = await signInWithSavedLocale("nl");
    const locale = cookies.find((cookie) => cookie.startsWith("EDULIMS_LOCALE="));
    expect(locale).toMatch(/^EDULIMS_LOCALE=nl;/);
    expect(locale).toMatch(/Path=\//i);
    expect(locale).toMatch(/SameSite=Lax/i);
    expect(locale).not.toMatch(/HttpOnly/i);
  });

  it("leaves the locale cookie alone when the user saved none", async () => {
    const { cookies } = await signInWithSavedLocale(null);
    expect(cookies.some((cookie) => cookie.startsWith("EDULIMS_LOCALE="))).toBe(false);
    expect(cookies.some((cookie) => cookie.includes("session_token"))).toBe(true);
  });

  it("refuses the locale through better-auth's own update-user endpoint (input: false)", async () => {
    const { auth, database, cookies } = await signInWithSavedLocale(null);
    const headers = new Headers({ cookie: cookies.map((c) => c.split(";")[0]).join("; ") });
    // @ts-expect-error input: false also removes `locale` from the endpoint's body type.
    await expect(auth.api.updateUser({ body: { locale: "de" }, headers })).rejects.toThrow();
    const row = await database
      .selectFrom("user")
      .select("locale")
      .where("email", "=", EMAIL)
      .executeTakeFirst();
    expect(row?.locale).toBeNull();
  });
});
