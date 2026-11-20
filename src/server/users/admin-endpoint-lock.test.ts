// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// better-auth's endpoints that delete a user (#318) or write a user's roles (#345) answer 404,
// over HTTP and on `auth.api`.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { Auth } from "../auth.ts";
import type { DB } from "../db/schema.gen.ts";
import { RefusalDeduper } from "../scim/audit.ts";
import { withAppOrigin } from "../test-auth.ts";
import { CLOSED_AUTH_PATHS, HTTP_CLOSED_AUTH_PATHS } from "./admin-endpoint-lock.ts";
import { authOnTestDb, createUser, signIn } from "./test-helpers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

/** An administrator's session and a student to delete, on a fresh test database. */
async function setup(): Promise<{
  auth: Auth;
  database: Kysely<DB>;
  victimId: string;
  headers: Headers;
}> {
  const opened = await authOnTestDb();
  db = opened.db;
  await createUser(opened.auth, "admin@example.test", ["admin"]);
  const victimId = await createUser(opened.auth, "victim@example.test", ["student"]);
  await signIn(opened.auth, "victim@example.test");
  const headers = await signIn(opened.auth, "admin@example.test");
  return { auth: opened.auth, database: opened.db, victimId, headers };
}

async function userCount(database: Kysely<DB>, userId: string): Promise<number> {
  const rows = await database.selectFrom("user").select("id").where("id", "=", userId).execute();
  return rows.length;
}

function request(path: string, method: "GET" | "POST", headers: Headers, body?: unknown) {
  return new Request(`http://localhost:3000/api/auth${path}`, {
    method,
    headers: withAppOrigin({ ...Object.fromEntries(headers), "content-type": "application/json" }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("the user deletion endpoints of better-auth (#318)", () => {
  it("lists the closed paths, and the paths closed over HTTP only", () => {
    expect([...CLOSED_AUTH_PATHS].sort()).toEqual([
      "/admin/remove-user",
      "/admin/set-role",
      "/admin/update-user",
      "/delete-user",
      "/delete-user/callback",
      "/update-user",
    ]);
    expect([...HTTP_CLOSED_AUTH_PATHS].sort()).toEqual(["/admin/ban-user", "/admin/create-user"]);
  });

  it.each([
    ["/admin/remove-user", "POST"],
    ["/admin/remove-user/", "POST"],
    ["/delete-user", "POST"],
    ["/delete-user/callback?token=made-up", "GET"],
  ] as const)("answers 404 to %s over HTTP, even for an administrator", async (path, method) => {
    const { auth, database, victimId, headers } = await setup();
    const body = method === "POST" ? { userId: victimId } : undefined;
    const response = await auth.handler(request(path, method, headers, body));
    expect([path, response.status]).toEqual([path, 404]);
    expect(await userCount(database, victimId)).toBe(1);
  });

  it("refuses auth.api.removeUser with 404 and deletes nothing", async () => {
    const { auth, database, victimId, headers } = await setup();
    await expect(
      auth.api.removeUser({ body: { userId: victimId }, headers }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(await userCount(database, victimId)).toBe(1);
  });

  it("refuses auth.api.deleteUser with 404, so a user cannot delete their own account", async () => {
    const { auth, database, victimId } = await setup();
    const victim = await signIn(auth, "victim@example.test");
    await expect(auth.api.deleteUser({ body: {}, headers: victim })).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(await userCount(database, victimId)).toBe(1);
  });

  it("refuses auth.api.deleteUserCallback with 404", async () => {
    const { auth, database, victimId } = await setup();
    const victim = await signIn(auth, "victim@example.test");
    await expect(
      auth.api.deleteUserCallback({ query: { token: "made-up" }, headers: victim }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(await userCount(database, victimId)).toBe(1);
  });
});

async function stored(database: Kysely<DB>, userId: string) {
  return database
    .selectFrom("user")
    .select(["name", "role"])
    .where("id", "=", userId)
    .executeTakeFirstOrThrow();
}

describe("the role-writing endpoints of better-auth (#345)", () => {
  it.each([
    ["/admin/set-role", { role: "teacher" }],
    ["/admin/set-role/", { role: "teacher" }],
    ["/admin/update-user", { data: { role: "teacher" } }],
    ["/admin/update-user", { data: { name: "Renamed" } }],
  ] as const)("answers 404 to %s %j over HTTP for an administrator", async (path, body) => {
    const { auth, database, victimId, headers } = await setup();
    const before = await stored(database, victimId);
    const response = await auth.handler(
      request(path, "POST", headers, { userId: victimId, ...body }),
    );
    expect([path, response.status]).toEqual([path, 404]);
    expect(await stored(database, victimId)).toEqual(before);
  });

  it("refuses auth.api.setRole with 404 and keeps the role", async () => {
    const { auth, database, victimId, headers } = await setup();
    const before = await stored(database, victimId);
    await expect(
      auth.api.setRole({ body: { userId: victimId, role: "teacher" }, headers }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(await stored(database, victimId)).toEqual(before);
  });

  it("refuses auth.api.adminUpdateUser with 404 and keeps the role and the name", async () => {
    const { auth, database, victimId, headers } = await setup();
    const before = await stored(database, victimId);
    await expect(
      auth.api.adminUpdateUser({
        body: { userId: victimId, data: { role: "teacher", name: "Renamed" } },
        headers,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(await stored(database, victimId)).toEqual(before);
  });
});

function closedRows(database: Kysely<DB>) {
  return database
    .selectFrom("audit_event")
    .select(["actor_type", "actor_id", "outcome", "reason_code", "target_id"])
    .where("action", "=", "authz_endpoint_closed")
    .orderBy("id")
    .execute();
}

describe("a call to a closed endpoint is logged (#356 review, S1, V16.3.2)", () => {
  it("logs an administrator's set-role on their own id as one refused row", async () => {
    const { auth, database, headers } = await setup();
    const adminId = (
      await database
        .selectFrom("user")
        .select("id")
        .where("email", "=", "admin@example.test")
        .executeTakeFirstOrThrow()
    ).id;
    const response = await auth.handler(
      request("/admin/set-role", "POST", headers, { userId: adminId, role: "teacher" }),
    );
    expect(response.status).toBe(404);
    expect(await closedRows(database)).toEqual([
      {
        actor_type: "user",
        actor_id: adminId,
        outcome: "refused",
        reason_code: "endpoint_closed",
        target_id: adminId,
      },
    ]);
  });

  it("logs a call without a session as anonymous, with no target (second review, S4)", async () => {
    const { auth, database, victimId } = await setup();
    await expect(
      auth.api.setRole({ body: { userId: victimId, role: "teacher" }, headers: new Headers() }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(await closedRows(database)).toEqual([
      expect.objectContaining({ actor_type: "anonymous", actor_id: null, target_id: null }),
    ]);
  });

  it("logs many anonymous calls of one client in a minute as one row (second review, S4)", async () => {
    const { auth, database, victimId } = await setup();
    for (let call = 0; call < 5; call += 1) {
      const response = await auth.handler(
        request("/admin/set-role", "POST", new Headers(), { userId: victimId, role: "admin" }),
      );
      expect(response.status).toBe(404);
    }
    const rows = await database
      .selectFrom("audit_event")
      .select(["actor_type", "target_id", "metadata"])
      .where("action", "=", "authz_endpoint_closed")
      .orderBy("id")
      .execute();
    expect(rows).toEqual([
      { actor_type: "anonymous", target_id: null, metadata: { refused_count: 1 } },
    ]);
  });
});

describe("the deduplication of anonymous calls (second review of #356, S4)", () => {
  it("counts the calls left out in the next row of the same client", () => {
    const deduper = new RefusalDeduper(60_000);
    expect(deduper.next("ip:unknown", 0)).toBe(1);
    expect(deduper.next("ip:unknown", 1_000)).toBeNull();
    expect(deduper.next("ip:unknown", 2_000)).toBeNull();
    expect(deduper.next("ip:unknown", 60_000)).toBe(3);
  });
});

describe("the endpoints closed over HTTP only (#356 review, S2, S3)", () => {
  it("answers 404 to an administrator's create-user and creates no user", async () => {
    const { auth, database, headers } = await setup();
    const response = await auth.handler(
      request("/admin/create-user", "POST", headers, {
        email: "new-admin@example.test",
        name: "New",
        password: "correct-horse-battery",
        role: "admin",
      }),
    );
    expect(response.status).toBe(404);
    const rows = await database
      .selectFrom("user")
      .select("id")
      .where("email", "=", "new-admin@example.test")
      .execute();
    expect(rows).toEqual([]);
  });

  it("answers 404 to an administrator's ban-user and blocks nobody", async () => {
    const { auth, database, victimId, headers } = await setup();
    const response = await auth.handler(
      request("/admin/ban-user", "POST", headers, { userId: victimId }),
    );
    expect(response.status).toBe(404);
    const row = await database
      .selectFrom("user")
      .select("banned")
      .where("id", "=", victimId)
      .executeTakeFirstOrThrow();
    expect(row.banned).toBe(false);
  });
});

describe("the core update-user endpoint (#356 review, en-route)", () => {
  it.each([
    ["a new name", { name: "Renamed Student" }],
    ["the admin role", { role: "admin" }],
  ] as const)("answers 404 to a student who sends %s, and changes nothing", async (_, body) => {
    const { auth, database, victimId } = await setup();
    const student = await signIn(auth, "victim@example.test");
    const before = await stored(database, victimId);
    const response = await auth.handler(request("/update-user", "POST", student, body));
    expect(response.status).toBe(404);
    expect(await stored(database, victimId)).toEqual(before);
  });
});
