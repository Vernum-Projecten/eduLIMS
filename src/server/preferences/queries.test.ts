// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { locales } from "../../i18n/runtime.js";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { AuthError } from "../middleware.ts";
import { storePreferredLocale } from "./queries.ts";
import { savePreferredLocaleInput } from "./schemas.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function setup(): Promise<Kysely<DB>> {
  db = await createTestDb();
  await db
    .insertInto("user")
    .values([
      { id: "u-own", name: "Own Student", email: "own@example.test", emailVerified: true },
      { id: "u-other", name: "Other Student", email: "other@example.test", emailVerified: true },
    ])
    .execute();
  return db;
}

async function localeOf(database: Kysely<DB>, id: string): Promise<string | null | undefined> {
  const row = await database
    .selectFrom("user")
    .select("locale")
    .where("id", "=", id)
    .executeTakeFirst();
  return row?.locale;
}

describe("savePreferredLocaleInput", () => {
  it.each(locales)("accepts the Paraglide locale %j", (locale) => {
    expect(savePreferredLocaleInput.parse({ locale })).toEqual({ locale });
  });

  it.each([["de"], ["NL"], ["nl-NL"], [""], ['nl\'; drop table "user"; --'], [42], [null]])(
    "refuses %j",
    (locale) => {
      expect(() => savePreferredLocaleInput.parse({ locale })).toThrow(ZodError);
    },
  );
});

describe("storePreferredLocale", () => {
  it("refuses a call without a session with 401", async () => {
    const database = await setup();
    const error = await storePreferredLocale(database, null, { locale: "nl" }).catch((e) => e);
    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({ status: 401 });
  });

  it("refuses a locale that is not a Paraglide locale and saves nothing", async () => {
    const database = await setup();
    await expect(storePreferredLocale(database, { id: "u-own" }, { locale: "de" })).rejects.toThrow(
      ZodError,
    );
    expect(await localeOf(database, "u-own")).toBeNull();
  });

  it("saves the locale on the session user's own row only", async () => {
    const database = await setup();
    await expect(storePreferredLocale(database, { id: "u-own" }, { locale: "nl" })).resolves.toBe(
      "nl",
    );
    expect(await localeOf(database, "u-own")).toBe("nl");
    expect(await localeOf(database, "u-other")).toBeNull();
  });
});

describe("user.locale column", () => {
  it("accepts every Paraglide locale (a new locale needs a migration)", async () => {
    const database = await setup();
    for (const locale of locales) {
      await database.updateTable("user").set({ locale }).where("id", "=", "u-own").execute();
      expect(await localeOf(database, "u-own")).toBe(locale);
    }
  });

  it("refuses any other value in the database itself", async () => {
    const database = await setup();
    await expect(
      database.updateTable("user").set({ locale: "de" }).where("id", "=", "u-own").execute(),
    ).rejects.toThrow(/check constraint/);
  });
});
