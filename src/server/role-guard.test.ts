// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuth } from "./auth.ts";
import type { DB } from "./db/schema.gen.ts";
import { createTestDb } from "./db/test-db.ts";
import { parseEnv } from "./env.ts";
import { guardRoleValue } from "./role-guard.ts";
import { VALID_ENV } from "./test-env.ts";

const PASSWORD = "correct-horse-battery";
let db: Kysely<DB> | undefined;

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db?.destroy();
  db = undefined;
});

async function setup() {
  const database = await createTestDb();
  db = database;
  const auth = createAuth(parseEnv({ ...VALID_ENV, EDULIMS_DEV_LOGIN: "true" }), {
    db: database,
    type: "postgres",
  });
  return { auth, database };
}

async function storedRole(database: Kysely<DB>, email: string) {
  const row = await database
    .selectFrom("user")
    .select("role")
    .where("email", "=", email)
    .executeTakeFirst();
  return row?.role;
}

/** Creates an administrator and returns the headers of their signed-in session. */
async function adminHeaders(auth: ReturnType<typeof createAuth>): Promise<Headers> {
  await auth.api.createUser({
    body: {
      email: "admin@example.test",
      name: "Test Administrator",
      password: PASSWORD,
      role: "admin",
    },
  });
  const response = await auth.api.signInEmail({
    body: { email: "admin@example.test", password: PASSWORD },
    asResponse: true,
  });
  const cookie = response.headers.getSetCookie().map((c) => c.split(";")[0]);
  return new Headers({ cookie: cookie.join("; ") });
}

describe("guardRoleValue", () => {
  it("returns the sorted stored form of an allowed set", () => {
    expect(guardRoleValue(["admin", "teacher"])).toBe("teacher,admin");
    expect(guardRoleValue("student")).toBe("student");
  });

  it.each([["student,teacher"], [["student", "admin"]], ["user"], [""]])(
    "throws for %j, logging only the reason",
    (value) => {
      expect(() => guardRoleValue(value)).toThrow();
      expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toMatch(/student|admin|user/);
    },
  );
});

describe("role writes through better-auth (ADR 0012)", () => {
  it("stores a teacher-admin created by the seed path, sorted", async () => {
    const { auth, database } = await setup();
    await auth.api.createUser({
      body: {
        email: "teacher-admin@example.test",
        name: "Test Coordinator",
        password: PASSWORD,
        role: ["admin", "teacher"],
      },
    });
    expect(await storedRole(database, "teacher-admin@example.test")).toBe("teacher,admin");
  });

  it.each([[["student", "teacher"]], [["student", "admin"]]] as const)(
    "refuses to create a user with %j",
    async (role) => {
      const { auth, database } = await setup();
      await expect(
        auth.api.createUser({
          body: { email: "x@example.test", name: "X", password: PASSWORD, role: [...role] },
        }),
      ).rejects.toThrow();
      expect(await storedRole(database, "x@example.test")).toBeUndefined();
    },
  );

  it("refuses set-role with a conflicting set and keeps the stored role", async () => {
    const { auth, database } = await setup();
    const headers = await adminHeaders(auth);
    const { user } = await auth.api.createUser({
      body: { email: "s@example.test", name: "S", password: PASSWORD, role: "student" },
    });
    await expect(
      auth.api.setRole({ body: { userId: user.id, role: ["student", "teacher"] }, headers }),
    ).rejects.toThrow();
    expect(await storedRole(database, "s@example.test")).toBe("student");
  });

  it("accepts set-role with teacher and admin", async () => {
    const { auth, database } = await setup();
    const headers = await adminHeaders(auth);
    const { user } = await auth.api.createUser({
      body: { email: "t@example.test", name: "T", password: PASSWORD, role: "teacher" },
    });
    await auth.api.setRole({ body: { userId: user.id, role: ["admin", "teacher"] }, headers });
    expect(await storedRole(database, "t@example.test")).toBe("teacher,admin");
  });

  it("refuses admin update-user with a conflicting role", async () => {
    const { auth, database } = await setup();
    const headers = await adminHeaders(auth);
    const { user } = await auth.api.createUser({
      body: { email: "t@example.test", name: "T", password: PASSWORD, role: "teacher" },
    });
    await expect(
      auth.api.adminUpdateUser({
        body: { userId: user.id, data: { role: "teacher,student" } },
        headers,
      }),
    ).rejects.toThrow();
    expect(await storedRole(database, "t@example.test")).toBe("teacher");
  });
});
