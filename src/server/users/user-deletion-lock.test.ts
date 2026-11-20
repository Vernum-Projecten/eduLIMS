// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// better-auth's endpoints that delete a user answer 404, over HTTP and on `auth.api` (#318).
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { Auth } from "../auth.ts";
import type { DB } from "../db/schema.gen.ts";
import { authOnTestDb, createUser, signIn } from "./test-helpers.ts";
import { USER_DELETION_DISABLED_PATHS } from "./user-deletion-lock.ts";

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
    headers: { ...Object.fromEntries(headers), "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("the user deletion endpoints of better-auth (#318)", () => {
  it("lists remove-user, delete-user and its callback as disabled paths", () => {
    expect([...USER_DELETION_DISABLED_PATHS].sort()).toEqual([
      "/admin/remove-user",
      "/delete-user",
      "/delete-user/callback",
    ]);
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
