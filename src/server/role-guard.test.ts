// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Auth } from "./auth.ts";
import type { DB } from "./db/schema.gen.ts";
import { createTestDb } from "./db/test-db.ts";
import { parseEnv } from "./env.ts";
import { guardRoleValue } from "./role-guard.ts";
import { setSecurityLogWriter } from "./security-log.ts";
import { createTestAuth } from "./test-auth.ts";
import { VALID_ENV } from "./test-env.ts";
import { TEST_PASSWORD } from "./users/test-helpers.ts";

let db: Kysely<DB> | undefined;
let logLines: string[] = [];
let restoreLog: (() => void) | undefined;

beforeEach(() => {
  logLines = [];
  restoreLog = setSecurityLogWriter((line) => logLines.push(line));
});

afterEach(async () => {
  restoreLog?.();
  vi.restoreAllMocks();
  await db?.destroy();
  db = undefined;
});

async function setup() {
  const database = await createTestDb();
  db = database;
  const auth = await createTestAuth(parseEnv({ ...VALID_ENV, EDULIMS_DEV_LOGIN: "true" }), {
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
async function adminHeaders(auth: Auth): Promise<Headers> {
  await auth.api.createUser({
    body: {
      email: "admin@example.test",
      name: "Test Administrator",
      password: TEST_PASSWORD,
      role: "admin",
    },
  });
  const response = await auth.api.signInEmail({
    body: { email: "admin@example.test", password: TEST_PASSWORD },
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
      expect(logLines).toHaveLength(1);
      expect(JSON.parse(logLines[0] ?? "null")).toMatchObject({
        event: "authz_role_write_refused",
        outcome: "refused",
      });
      expect(logLines.join("")).not.toMatch(/student|admin|user/);
    },
  );
});

describe("own role changes through the admin API (A01, ADR 0012, #345)", () => {
  async function admin(database: Kysely<DB>) {
    return database
      .selectFrom("user")
      .select(["id", "name", "role"])
      .where("email", "=", "admin@example.test")
      .executeTakeFirstOrThrow();
  }

  it("answers 404 to set-role on the administrator's own account", async () => {
    const { auth, database } = await setup();
    const headers = await adminHeaders(auth);
    const before = await admin(database);
    await expect(
      auth.api.setRole({ body: { userId: before.id, role: ["teacher", "admin"] }, headers }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(await admin(database)).toEqual(before);
  });

  it("answers 404 to update-user with data.role on the administrator's own account", async () => {
    const { auth, database } = await setup();
    const headers = await adminHeaders(auth);
    const before = await admin(database);
    await expect(
      auth.api.adminUpdateUser({
        body: { userId: before.id, data: { role: "teacher,admin" } },
        headers,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(await admin(database)).toEqual(before);
  });

  it("answers 404 to update-user with a new name: names come from the provider", async () => {
    const { auth, database } = await setup();
    const headers = await adminHeaders(auth);
    const before = await admin(database);
    await expect(
      auth.api.adminUpdateUser({ body: { userId: before.id, data: { name: "Renamed" } }, headers }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(await admin(database)).toEqual(before);
  });
});

describe("the role column CHECK (0004_user_role_check)", () => {
  it.each(["student", "teacher", "admin", "teacher,admin", null])("accepts %j", async (role) => {
    const { database } = await setup();
    await database
      .insertInto("user")
      .values({ id: "u-check", name: "C", email: "c@example.test", emailVerified: true, role })
      .execute();
    expect(await storedRole(database, "c@example.test")).toBe(role);
  });

  it.each(["student,admin", "student,teacher", "admin,teacher", "user", ""])(
    "refuses %j in the database itself",
    async (role) => {
      const { database } = await setup();
      await expect(
        database
          .insertInto("user")
          .values({ id: "u-check", name: "C", email: "c@example.test", emailVerified: true, role })
          .execute(),
      ).rejects.toThrow(/check constraint/);
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
        password: TEST_PASSWORD,
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
          body: { email: "x@example.test", name: "X", password: TEST_PASSWORD, role: [...role] },
        }),
      ).rejects.toThrow();
      expect(await storedRole(database, "x@example.test")).toBeUndefined();
    },
  );

  // The IdP sign-in gate and SCIM write roles through the internal adapter, which runs the hooks.
  async function teacher(auth: Auth) {
    const { user } = await auth.api.createUser({
      body: { email: "t@example.test", name: "T", password: TEST_PASSWORD, role: "teacher" },
    });
    return { id: user.id, adapter: (await auth.$context).internalAdapter };
  }

  it("refuses an update with a conflicting set and keeps the stored role", async () => {
    const { auth, database } = await setup();
    const { id, adapter } = await teacher(auth);
    await expect(adapter.updateUser(id, { role: "teacher,student" })).rejects.toThrow();
    expect(await storedRole(database, "t@example.test")).toBe("teacher");
  });

  it("stores an update with teacher and admin, sorted", async () => {
    const { auth, database } = await setup();
    const { id, adapter } = await teacher(auth);
    await adapter.updateUser(id, { role: ["admin", "teacher"] });
    expect(await storedRole(database, "t@example.test")).toBe("teacher,admin");
  });
});
