// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { createAuth } from "./auth.ts";
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
