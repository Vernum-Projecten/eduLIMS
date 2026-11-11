// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dayIn } from "../../lib/app-day.ts";
import type { DB } from "../db/schema.gen.ts";
import { AuthError } from "../middleware.ts";
import {
  assertAdmin,
  blockUser,
  endAllSessions,
  endSession,
  setLocalRoles,
  unblockUser,
} from "./actions.ts";
import { authOnTestDb, createUser, signedInActor, signIn, TEST_PASSWORD } from "./test-helpers.ts";

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
  const env = await authOnTestDb();
  db = env.db;
  const admin = await signedInActor(env.auth, env.db, "admin@example.test", ["admin"]);
  return { ...env, admin };
}

function events(database: Kysely<DB>, action: string) {
  return database
    .selectFrom("audit_event")
    .select(["action", "actor_id", "target_type", "target_id", "outcome", "reason_code"])
    .select("metadata")
    .where("action", "=", action)
    .orderBy("occurred_at")
    .execute();
}

function sessionsOf(database: Kysely<DB>, userId: string) {
  return database.selectFrom("session").select("id").where("userId", "=", userId).execute();
}

function tomorrowPlus(days: number): string {
  return dayIn(new Date(Date.now() + days * 86_400_000));
}

describe("assertAdmin (B1, ADR 0012)", () => {
  it.each([[["student"]], [["teacher"]], [[]]] as const)("refuses %j with 403", (roles) => {
    expect(() => assertAdmin({ roles })).toThrow(AuthError);
  });

  it("allows an administrator and a teacher-admin", () => {
    expect(() => assertAdmin({ roles: ["admin"] })).not.toThrow();
    expect(() => assertAdmin({ roles: ["teacher", "admin"] })).not.toThrow();
  });
});

describe("the actions refuse callers without the admin role (A01)", () => {
  it.each([
    ["student", ["student"]],
    ["teacher", ["teacher"]],
  ] as const)("a %s cannot block, unblock, end sessions or set roles", async (name, roles) => {
    const { auth, db: database } = await setup();
    const target = await createUser(auth, "target@example.test", ["student"]);
    const ctx = await signedInActor(auth, database, `${name}2@example.test`, roles);
    await expect(blockUser(ctx, { userId: target, reason: "x", until: "" })).rejects.toThrow(
      AuthError,
    );
    await expect(unblockUser(ctx, { userId: target })).rejects.toThrow(AuthError);
    await expect(endSession(ctx, { userId: target, sessionId: "s" })).rejects.toThrow(AuthError);
    await expect(endAllSessions(ctx, { userId: target })).rejects.toThrow(AuthError);
    await expect(setLocalRoles(ctx, { userId: target, roles: ["teacher"] })).rejects.toThrow(
      AuthError,
    );
  });

  it("a teacher-admin acts as an administrator: they hold the admin role", async () => {
    const { auth, db: database } = await setup();
    const target = await createUser(auth, "target@example.test", ["student"]);
    const ctx = await signedInActor(auth, database, "coordinator@example.test", [
      "teacher",
      "admin",
    ]);
    expect(await setLocalRoles(ctx, { userId: target, roles: ["teacher"] })).toEqual({ ok: true });
  });
});

describe("blockUser (owner decision on #32)", () => {
  it("blocks with a reason and an end date, ends the sessions and logs it", async () => {
    const { auth, db: database, admin } = await setup();
    const target = await createUser(auth, "target@example.test", ["student"]);
    await signIn(auth, "target@example.test");
    const until = tomorrowPlus(3);
    expect(await blockUser(admin, { userId: target, reason: " Shared account ", until })).toEqual({
      ok: true,
    });
    const row = await database
      .selectFrom("user")
      .select(["banned", "banReason", "banExpires"])
      .where("id", "=", target)
      .executeTakeFirstOrThrow();
    expect(row.banned).toBe(true);
    expect(row.banReason).toBe("Shared account");
    expect(dayIn(new Date((row.banExpires?.getTime() ?? 0) - 1000))).toBe(until);
    expect(await sessionsOf(database, target)).toEqual([]);
    expect(await events(database, "user_banned")).toEqual([
      expect.objectContaining({ actor_id: admin.actor.id, target_id: target, outcome: "success" }),
    ]);
  });

  it("blocks without an end date", async () => {
    const { auth, db: database, admin } = await setup();
    const target = await createUser(auth, "target@example.test", ["student"]);
    expect(await blockUser(admin, { userId: target, reason: "Left", until: "" })).toEqual({
      ok: true,
    });
    const row = await database
      .selectFrom("user")
      .select("banExpires")
      .where("id", "=", target)
      .executeTakeFirstOrThrow();
    expect(row.banExpires).toBeNull();
  });

  it("refuses the blocked user's next sign-in with BANNED_USER", async () => {
    const { auth, admin } = await setup();
    const target = await createUser(auth, "target@example.test", ["student"]);
    await blockUser(admin, { userId: target, reason: "Misuse", until: "" });
    const response = await auth.api.signInEmail({
      body: { email: "target@example.test", password: TEST_PASSWORD },
      asResponse: true,
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "BANNED_USER" });
  });

  it("refuses to block the administrator themselves and logs the refusal", async () => {
    const { db: database, admin } = await setup();
    expect(await blockUser(admin, { userId: admin.actor.id, reason: "x", until: "" })).toEqual({
      ok: false,
      error: "cannot_block_self",
    });
    expect(await events(database, "user_banned")).toEqual([
      expect.objectContaining({ outcome: "refused", reason_code: "cannot_block_self" }),
    ]);
  });

  it("answers not_found for an unknown user", async () => {
    const { admin } = await setup();
    expect(await blockUser(admin, { userId: "nobody", reason: "x", until: "" })).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});

describe("unblockUser", () => {
  it("lifts a block and logs it", async () => {
    const { auth, db: database, admin } = await setup();
    const target = await createUser(auth, "target@example.test", ["student"]);
    await blockUser(admin, { userId: target, reason: "x", until: "" });
    expect(await unblockUser(admin, { userId: target })).toEqual({ ok: true });
    await expect(signIn(auth, "target@example.test")).resolves.toBeInstanceOf(Headers);
    expect(await events(database, "user_unbanned")).toHaveLength(1);
  });

  it("answers not_found for an unknown user", async () => {
    const { admin } = await setup();
    expect(await unblockUser(admin, { userId: "nobody" })).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});

describe("endSession and endAllSessions", () => {
  it("ends one session of another user by its id and logs it", async () => {
    const { auth, db: database, admin } = await setup();
    const target = await createUser(auth, "target@example.test", ["teacher"]);
    await signIn(auth, "target@example.test");
    await signIn(auth, "target@example.test");
    const [first, second] = await sessionsOf(database, target);
    expect(await endSession(admin, { userId: target, sessionId: first?.id ?? "" })).toEqual({
      ok: true,
    });
    expect(await sessionsOf(database, target)).toEqual([second]);
    expect(await events(database, "session_revoked")).toEqual([
      expect.objectContaining({ actor_id: admin.actor.id, target_id: first?.id }),
    ]);
  });

  it("refuses a session id of another user (IDOR)", async () => {
    const { auth, db: database, admin } = await setup();
    const target = await createUser(auth, "target@example.test", ["teacher"]);
    const other = await createUser(auth, "other@example.test", ["teacher"]);
    await signIn(auth, "other@example.test");
    const [session] = await sessionsOf(database, other);
    expect(await endSession(admin, { userId: target, sessionId: session?.id ?? "" })).toEqual({
      ok: false,
      error: "session_not_found",
    });
    expect(await sessionsOf(database, other)).toHaveLength(1);
  });

  it("refuses to end the administrator's current session", async () => {
    const { db: database, admin } = await setup();
    const [current] = await sessionsOf(database, admin.actor.id);
    expect(
      await endSession(admin, { userId: admin.actor.id, sessionId: current?.id ?? "" }),
    ).toEqual({ ok: false, error: "cannot_end_current_session" });
    expect(await events(database, "session_revoked")).toEqual([
      expect.objectContaining({ outcome: "refused", reason_code: "cannot_end_current_session" }),
    ]);
  });

  it("lets the administrator end another of their own sessions", async () => {
    const { auth, db: database, admin } = await setup();
    await signIn(auth, "admin@example.test");
    const current = (await auth.api.getSession({ headers: admin.headers }))?.session.id;
    const other = (await sessionsOf(database, admin.actor.id)).find((s) => s.id !== current);
    expect(await endSession(admin, { userId: admin.actor.id, sessionId: other?.id ?? "" })).toEqual(
      { ok: true },
    );
    expect(await sessionsOf(database, admin.actor.id)).toEqual([{ id: current }]);
  });

  it("ends every session of another user", async () => {
    const { auth, db: database, admin } = await setup();
    const target = await createUser(auth, "target@example.test", ["teacher"]);
    await signIn(auth, "target@example.test");
    await signIn(auth, "target@example.test");
    expect(await endAllSessions(admin, { userId: target })).toEqual({ ok: true });
    expect(await sessionsOf(database, target)).toEqual([]);
  });

  it("ends every other session, never the current one, on the administrator's account", async () => {
    const { auth, db: database, admin } = await setup();
    await signIn(auth, "admin@example.test");
    await signIn(auth, "admin@example.test");
    const current = (await auth.api.getSession({ headers: admin.headers }))?.session.id;
    expect(await endAllSessions(admin, { userId: admin.actor.id })).toEqual({ ok: true });
    expect(await sessionsOf(database, admin.actor.id)).toEqual([{ id: current }]);
  });
});

describe("setLocalRoles (hybrid role ownership, owner decision on #32)", () => {
  it("changes a local role set in one transaction with its activity-log row", async () => {
    const { auth, db: database, admin } = await setup();
    const target = await createUser(auth, "target@example.test", ["teacher"]);
    expect(await setLocalRoles(admin, { userId: target, roles: ["admin", "teacher"] })).toEqual({
      ok: true,
    });
    const row = await database
      .selectFrom("user")
      .select(["role", "role_source"])
      .where("id", "=", target)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ role: "teacher,admin", role_source: "local" });
    expect(await events(database, "authz_role_change")).toEqual([
      expect.objectContaining({
        actor_id: admin.actor.id,
        target_id: target,
        outcome: "success",
        metadata: { roles: "teacher,admin", previous_roles: "teacher" },
      }),
    ]);
  });

  it("writes nothing for an unchanged set", async () => {
    const { auth, db: database, admin } = await setup();
    const target = await createUser(auth, "target@example.test", ["teacher"]);
    expect(await setLocalRoles(admin, { userId: target, roles: ["teacher"] })).toEqual({
      ok: true,
    });
    expect(await events(database, "authz_role_change")).toEqual([]);
  });

  it("refuses a role set the identity provider owns and logs the refusal", async () => {
    const { auth, db: database, admin } = await setup();
    const target = await createUser(auth, "target@example.test", ["teacher"]);
    await database
      .updateTable("user")
      .set({ role_source: "keycloak" })
      .where("id", "=", target)
      .execute();
    expect(await setLocalRoles(admin, { userId: target, roles: ["admin"] })).toEqual({
      ok: false,
      error: "roles_not_local",
    });
    const row = await database
      .selectFrom("user")
      .select("role")
      .where("id", "=", target)
      .executeTakeFirstOrThrow();
    expect(row.role).toBe("teacher");
    expect(await events(database, "authz_role_change")).toEqual([
      expect.objectContaining({ outcome: "refused", reason_code: "roles_not_local" }),
    ]);
  });

  it("refuses the administrator's own roles (ADR 0012)", async () => {
    const { db: database, admin } = await setup();
    expect(
      await setLocalRoles(admin, { userId: admin.actor.id, roles: ["teacher", "admin"] }),
    ).toEqual({ ok: false, error: "cannot_change_own_roles" });
    expect(await events(database, "authz_role_change")).toEqual([
      expect.objectContaining({ outcome: "refused", reason_code: "cannot_change_own_roles" }),
    ]);
  });

  it.each([[["student", "admin"]], [["student", "teacher"]], [[]]] as const)(
    "refuses the set %j (ADR 0012)",
    async (roles) => {
      const { auth, admin } = await setup();
      const target = await createUser(auth, "target@example.test", ["teacher"]);
      expect(await setLocalRoles(admin, { userId: target, roles })).toEqual({
        ok: false,
        error: "role_set_not_allowed",
      });
    },
  );

  it("answers not_found for an unknown user", async () => {
    const { admin } = await setup();
    expect(await setLocalRoles(admin, { userId: "nobody", roles: ["teacher"] })).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});
