// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { type Kysely, sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "./db/schema.gen.ts";
import { createTestDb } from "./db/test-db.ts";
import { parseEnv } from "./env.ts";
import { resolveSessionUser } from "./session.ts";
import {
  isPastAbsoluteLifetime,
  SESSION_ABSOLUTE_MAX_SECONDS,
  SESSION_EXPIRES_IN_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
} from "./session-policy.ts";
// Session lifetimes (#42, ASVS V7.3.1, V7.3.2) against better-auth and the real database.
import { createTestAuth } from "./test-auth.ts";
import { VALID_ENV } from "./test-env.ts";

const PASSWORD = "correct-horse-battery";
const HOUR_MS = 60 * 60 * 1000;
let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

/** Signs a dev user in and returns the auth instance, the database and the session cookie. */
async function signedIn() {
  db = await createTestDb();
  const auth = await createTestAuth(parseEnv(VALID_ENV), { db, type: "postgres" });
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
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  return { auth, database: db, headers: new Headers({ cookie }) };
}

/** Moves the only session's sign-in and last refresh back in time by the given hours. */
async function age(database: Kysely<DB>, signedInHoursAgo: number, refreshedHoursAgo: number) {
  await sql`
    update "session" set
      "createdAt" = now() - make_interval(hours => ${signedInHoursAgo}),
      "updatedAt" = now() - make_interval(hours => ${refreshedHoursAgo}),
      "expiresAt" = now() - make_interval(hours => ${refreshedHoursAgo}) + make_interval(secs => ${SESSION_EXPIRES_IN_SECONDS})
  `.execute(database);
}

async function expiresAt(database: Kysely<DB>): Promise<Date | undefined> {
  const row = await database.selectFrom("session").select("expiresAt").executeTakeFirst();
  return row?.expiresAt;
}

describe("session policy (#42)", () => {
  it("is 8 hours sliding, refreshed at most hourly, capped at 24 hours", () => {
    expect(SESSION_EXPIRES_IN_SECONDS).toBe(8 * 3600);
    expect(SESSION_UPDATE_AGE_SECONDS).toBe(3600);
    expect(SESSION_ABSOLUTE_MAX_SECONDS).toBe(24 * 3600);
  });

  it("counts a session past its absolute lifetime from 24 hours after sign-in", () => {
    const now = new Date("2026-11-11T12:00:00Z");
    expect(isPastAbsoluteLifetime(new Date("2026-11-10T12:00:01Z"), now)).toBe(false);
    expect(isPastAbsoluteLifetime(new Date("2026-11-10T12:00:00Z"), now)).toBe(true);
    expect(isPastAbsoluteLifetime(new Date("not a date"), now)).toBe(true);
  });
});

describe("session lifetimes in better-auth (#42, ASVS V7.3.1, V7.3.2)", () => {
  it("issues a session that expires 8 hours after sign-in", async () => {
    const before = Date.now();
    const { database } = await signedIn();
    const after = Date.now();
    const expires = (await expiresAt(database))?.getTime() ?? 0;
    expect(expires).toBeGreaterThanOrEqual(before + 8 * HOUR_MS - 1000);
    expect(expires).toBeLessThanOrEqual(after + 8 * HOUR_MS + 1000);
  });

  it("does not refresh a session used within the hour", async () => {
    const { auth, database, headers } = await signedIn();
    const before = await expiresAt(database);
    await resolveSessionUser(auth, headers);
    expect(await expiresAt(database)).toEqual(before);
  });

  it("slides the expiry to 8 hours from now once the last refresh is over an hour old", async () => {
    const { auth, database, headers } = await signedIn();
    await age(database, 2, 2);
    const before = Date.now();
    expect(await resolveSessionUser(auth, headers)).toMatchObject({
      email: "teacher@example.test",
    });
    const after = Date.now();
    const expires = (await expiresAt(database))?.getTime() ?? 0;
    expect(expires).toBeGreaterThanOrEqual(before + 8 * HOUR_MS - 1000);
    expect(expires).toBeLessThanOrEqual(after + 8 * HOUR_MS + 1000);
  });

  it("refuses a session idle for more than 8 hours", async () => {
    const { auth, database, headers } = await signedIn();
    await age(database, 9, 9);
    expect(await resolveSessionUser(auth, headers)).toBeNull();
  });

  it("never slides a session past 24 hours after sign-in (migration 0005)", async () => {
    const { auth, database, headers } = await signedIn();
    await age(database, 20, 2);
    expect(await resolveSessionUser(auth, headers)).not.toBeNull();
    const expires = (await expiresAt(database))?.getTime() ?? 0;
    expect(Math.abs(expires - Date.now() - 4 * HOUR_MS)).toBeLessThan(60_000);
  });

  it("revokes and refuses the session of a user the directory deprovisioned (#45, M3)", async () => {
    const { auth, database, headers } = await signedIn();
    expect(await resolveSessionUser(auth, headers)).not.toBeNull();
    await sql`update "user" set deprovisioned_at = now()`.execute(database);
    expect(await resolveSessionUser(auth, headers)).toBeNull();
    expect(await database.selectFrom("session").select("id").execute()).toEqual([]);
  });

  it("revokes and refuses a session signed in 24 hours ago, however recently used", async () => {
    const { auth, database, headers } = await signedIn();
    await sql`update "session" set "createdAt" = now() - interval '25 hours'`.execute(database);
    expect(await resolveSessionUser(auth, headers)).toBeNull();
    expect(await database.selectFrom("session").select("id").execute()).toEqual([]);
  });
});
