// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuth } from "./auth.ts";
import type { DB } from "./db/schema.gen.ts";
import { createTestDb } from "./db/test-db.ts";
import { parseEnv } from "./env.ts";
import { guardRoleValue, isOwnRoleWrite, OWN_ROLES_REFUSED } from "./role-guard.ts";
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

describe("isOwnRoleWrite", () => {
  it("is true for set-role and update-user with data.role on the session user", () => {
    expect(isOwnRoleWrite("/admin/set-role", { userId: "a1", role: "teacher" }, "a1")).toBe(true);
    expect(isOwnRoleWrite("/admin/update-user", { userId: "a1", data: { role: "x" } }, "a1")).toBe(
      true,
    );
  });

  it("is false for another user, other data, other paths and without a session", () => {
    expect(isOwnRoleWrite("/admin/set-role", { userId: "u2", role: "teacher" }, "a1")).toBe(false);
    expect(isOwnRoleWrite("/admin/update-user", { userId: "a1", data: { name: "A" } }, "a1")).toBe(
      false,
    );
    expect(isOwnRoleWrite("/admin/ban-user", { userId: "a1" }, "a1")).toBe(false);
    expect(isOwnRoleWrite("/admin/set-role", { userId: "a1", role: "admin" }, undefined)).toBe(
      false,
    );
    expect(isOwnRoleWrite("/admin/set-role", null, "a1")).toBe(false);
  });

  it("compares a numeric user id as the endpoint coerces it", () => {
    expect(isOwnRoleWrite("/admin/set-role", { userId: 7, role: "admin" }, "7")).toBe(true);
  });
});

describe("own role changes through the admin API (A01, ADR 0012)", () => {
  async function adminId(database: Kysely<DB>) {
    const row = await database
      .selectFrom("user")
      .select("id")
      .where("email", "=", "admin@example.test")
      .executeTakeFirstOrThrow();
    return row.id;
  }

  it("refuses set-role on the administrator's own account with 403", async () => {
    const { auth, database } = await setup();
    const headers = await adminHeaders(auth);
    const id = await adminId(database);
    const error = await auth.api
      .setRole({ body: { userId: id, role: ["teacher", "admin"] }, headers })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ statusCode: 403, body: { code: OWN_ROLES_REFUSED.code } });
    expect(await storedRole(database, "admin@example.test")).toBe("admin");
  });

  it("refuses update-user with data.role on the administrator's own account with 403", async () => {
    const { auth, database } = await setup();
    const headers = await adminHeaders(auth);
    const id = await adminId(database);
    const error = await auth.api
      .adminUpdateUser({ body: { userId: id, data: { role: "teacher,admin" } }, headers })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ statusCode: 403 });
    expect(await storedRole(database, "admin@example.test")).toBe("admin");
  });

  it("still lets the administrator change their own name", async () => {
    const { auth, database } = await setup();
    const headers = await adminHeaders(auth);
    const id = await adminId(database);
    await auth.api.adminUpdateUser({ body: { userId: id, data: { name: "Renamed" } }, headers });
    expect(await storedRole(database, "admin@example.test")).toBe("admin");
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
