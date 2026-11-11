// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { blockUser } from "./actions.ts";
import { getUserDetail, RECENT_ACTIVITY_LIMIT, shortenAccountId } from "./detail.ts";
import { authOnTestDb, createUser, signedInActor, signIn } from "./test-helpers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function setup() {
  const env = await authOnTestDb();
  db = env.db;
  const admin = await signedInActor(env.auth, env.db, "admin@example.test", ["admin"]);
  const sessionId = (await env.auth.api.getSession({ headers: admin.headers }))?.session.id ?? null;
  return { ...env, admin, viewer: { userId: admin.actor.id, sessionId } };
}

describe("shortenAccountId", () => {
  it("keeps a short id and cuts a long one to its ends", () => {
    expect(shortenAccountId("abc123")).toBe("abc123");
    expect(shortenAccountId("0123456789abcdef0123")).toBe("0123…0123");
  });
});

describe("getUserDetail (#34)", () => {
  it("returns null for an unknown user", async () => {
    const { db: database, viewer } = await setup();
    expect(await getUserDetail(database, "nobody", viewer, new Date())).toBeNull();
  });

  it("shows profile, local roles as editable, the account, the session and the sign-in", async () => {
    const { auth, db: database, viewer } = await setup();
    const id = await createUser(auth, "teacher@example.test", ["teacher"]);
    await signIn(auth, "teacher@example.test");
    const detail = await getUserDetail(database, id, viewer, new Date());
    expect(detail).toMatchObject({
      id,
      email: "teacher@example.test",
      roles: ["teacher"],
      roleSource: "local",
      rolesEditable: true,
      self: false,
      status: "active",
      block: null,
      lastSignInMethod: "credential",
    });
    expect(detail?.lastSignInAt).not.toBeNull();
    expect(detail?.accounts).toEqual([
      expect.objectContaining({ provider: "credential", accountIdShort: expect.any(String) }),
    ]);
    expect(detail?.sessions).toEqual([
      expect.objectContaining({ current: false, device: { browser: null, os: null } }),
    ]);
    expect(JSON.stringify(detail)).not.toMatch(/token|ipAddress|password/i);
  });

  it("marks IdP-sourced roles and the viewer's own roles as not editable", async () => {
    const { auth, db: database, viewer } = await setup();
    const id = await createUser(auth, "sso@example.test", ["student"]);
    await database
      .updateTable("user")
      .set({ role_source: "microsoft" })
      .where("id", "=", id)
      .execute();
    expect(await getUserDetail(database, id, viewer, new Date())).toMatchObject({
      roleSource: "microsoft",
      rolesEditable: false,
    });
    expect(await getUserDetail(database, viewer.userId, viewer, new Date())).toMatchObject({
      self: true,
      rolesEditable: false,
      sessions: [expect.objectContaining({ current: true })],
    });
  });

  it("shows a block and the last activity, newest first, at most ten events", async () => {
    const { auth, db: database, admin, viewer } = await setup();
    const id = await createUser(auth, "blocked@example.test", ["student"]);
    for (let i = 0; i < 11; i += 1) await signIn(auth, "blocked@example.test");
    await blockUser(admin, { userId: id, reason: "Shared account", until: "" });
    const detail = await getUserDetail(database, id, viewer, new Date());
    expect(detail?.status).toBe("blocked");
    expect(detail?.block).toEqual({ reason: "Shared account", until: null });
    expect(detail?.sessions).toEqual([]);
    expect(detail?.activity).toHaveLength(RECENT_ACTIVITY_LIMIT);
    expect(detail?.activity[0]).toMatchObject({ action: "user_banned", actor: "user" });
    expect(detail?.activity.some((event) => event.actor === "self")).toBe(true);
  });
});
