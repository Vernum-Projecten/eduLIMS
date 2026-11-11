// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// One test per event type of the activity log (B4): each flow writes exactly one row of its
// action with the expected outcome and reason, and nothing personal.
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuth } from "../auth.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { parseEnv } from "../env.ts";
import { VALID_ENV } from "../test-env.ts";
import { auditDatabase, auditRecorderOf, providerOf, requestIdOf } from "./better-auth-hooks.ts";
import type { AuditAction } from "./events.ts";

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

type Auth = ReturnType<typeof createAuth>;

async function setup() {
  const database = await createTestDb();
  db = database;
  const auth = createAuth(parseEnv({ ...VALID_ENV, EDULIMS_DEV_LOGIN: "true" }), {
    db: database,
    type: "postgres",
  });
  return { auth, database };
}

async function createUser(auth: Auth, email: string, role: "student" | "teacher" | "admin") {
  const { user } = await auth.api.createUser({
    body: { email, name: "Audit Person", password: PASSWORD, role },
  });
  return user.id;
}

async function signIn(auth: Auth, email: string): Promise<Headers> {
  const response = await auth.api.signInEmail({
    body: { email, password: PASSWORD },
    asResponse: true,
  });
  const cookie = response.headers.getSetCookie().map((c) => c.split(";")[0]);
  return new Headers({ cookie: cookie.join("; "), "x-request-id": "req-1" });
}

async function events(database: Kysely<DB>, action: AuditAction) {
  return database
    .selectFrom("audit_event")
    .select([
      "actor_type",
      "actor_id",
      "target_type",
      "target_id",
      "outcome",
      "reason_code",
      "provider",
      "request_id",
      "metadata",
    ])
    .where("action", "=", action)
    .execute();
}

async function adminAndStudent(auth: Auth) {
  const adminId = await createUser(auth, "admin@example.test", "admin");
  const studentId = await createUser(auth, "student@example.test", "student");
  const headers = await signIn(auth, "admin@example.test");
  return { adminId, studentId, headers };
}

describe("the activity log of better-auth flows (B4)", () => {
  it("records user_created for an administrator-created user", async () => {
    const { auth, database } = await setup();
    const id = await createUser(auth, "new@example.test", "teacher");
    expect(await events(database, "user_created")).toEqual([
      expect.objectContaining({
        actor_type: "system",
        target_type: "user",
        target_id: id,
        outcome: "success",
        metadata: { roles: "teacher" },
      }),
    ]);
  });

  it("records authn_login_success with the provider and request id", async () => {
    const { auth, database } = await setup();
    const id = await createUser(auth, "student@example.test", "student");
    await auth.api.signInEmail({
      body: { email: "student@example.test", password: PASSWORD },
      headers: new Headers({ "x-request-id": "req-login" }),
    });
    expect(await events(database, "authn_login_success")).toEqual([
      expect.objectContaining({
        actor_type: "user",
        actor_id: id,
        target_id: id,
        outcome: "success",
        provider: "credential",
        request_id: "req-login",
      }),
    ]);
  });

  it("records authn_login_fail for a wrong password, with the user id and no e-mail", async () => {
    const { auth, database } = await setup();
    const id = await createUser(auth, "student@example.test", "student");
    await expect(
      auth.api.signInEmail({ body: { email: "student@example.test", password: "wrong-one-1" } }),
    ).rejects.toThrow();
    const rows = await events(database, "authn_login_fail");
    expect(rows).toEqual([
      expect.objectContaining({
        actor_type: "anonymous",
        actor_id: null,
        target_id: id,
        outcome: "failure",
        reason_code: "invalid_email_or_password",
        provider: "credential",
      }),
    ]);
    expect(JSON.stringify(rows)).not.toContain("@");
  });

  it("records authn_login_fail for an unknown account without a target", async () => {
    const { auth, database } = await setup();
    await expect(
      auth.api.signInEmail({ body: { email: "nobody@example.test", password: PASSWORD } }),
    ).rejects.toThrow();
    expect(await events(database, "authn_login_fail")).toEqual([
      expect.objectContaining({ target_type: null, target_id: null, outcome: "failure" }),
    ]);
  });

  it("records authn_login_fail for a failed OAuth callback", async () => {
    const { auth, database } = await setup();
    const response = await auth.handler(
      new Request("http://localhost:3000/api/auth/callback/microsoft?code=x"),
    );
    expect(response.status).toBe(302);
    expect(await events(database, "authn_login_fail")).toEqual([
      expect.objectContaining({
        actor_type: "anonymous",
        outcome: "failure",
        reason_code: "state_not_found",
        provider: "microsoft",
      }),
    ]);
  });

  it("records authn_logout on sign-out, and no session_revoked", async () => {
    const { auth, database } = await setup();
    const id = await createUser(auth, "student@example.test", "student");
    const headers = await signIn(auth, "student@example.test");
    await auth.api.signOut({ headers });
    expect(await events(database, "authn_logout")).toEqual([
      expect.objectContaining({ actor_id: id, outcome: "success", request_id: "req-1" }),
    ]);
    expect(await events(database, "session_revoked")).toEqual([]);
  });

  it("records user_banned with the end date, and session_revoked for the ended session", async () => {
    const { auth, database } = await setup();
    const { adminId, studentId, headers } = await adminAndStudent(auth);
    await signIn(auth, "student@example.test");
    await auth.api.banUser({
      body: { userId: studentId, banReason: "Misuse of the lab", banExpiresIn: 86_400 },
      headers,
    });
    const [banned] = await events(database, "user_banned");
    expect(banned).toMatchObject({
      actor_id: adminId,
      target_id: studentId,
      outcome: "success",
      metadata: { ban_expires_at: expect.any(String) },
    });
    expect(JSON.stringify(banned)).not.toContain("Misuse");
    expect(await events(database, "session_revoked")).toEqual([
      expect.objectContaining({
        actor_id: adminId,
        target_type: "session",
        reason_code: "user_banned",
      }),
    ]);
  });

  it("records user_unbanned", async () => {
    const { auth, database } = await setup();
    const { adminId, studentId, headers } = await adminAndStudent(auth);
    await auth.api.banUser({ body: { userId: studentId }, headers });
    await auth.api.unbanUser({ body: { userId: studentId }, headers });
    expect(await events(database, "user_unbanned")).toEqual([
      expect.objectContaining({ actor_id: adminId, target_id: studentId, outcome: "success" }),
    ]);
  });

  it("records session_revoked when an administrator ends a session", async () => {
    const { auth, database } = await setup();
    const { adminId, studentId, headers } = await adminAndStudent(auth);
    await signIn(auth, "student@example.test");
    const { sessions } = await auth.api.listUserSessions({ body: { userId: studentId }, headers });
    const [session] = sessions;
    if (!session) throw new Error("expected a session");
    await auth.api.revokeUserSession({ body: { sessionToken: session.token }, headers });
    expect(await events(database, "session_revoked")).toEqual([
      expect.objectContaining({
        actor_id: adminId,
        target_type: "session",
        target_id: session.id,
        reason_code: null,
      }),
    ]);
  });

  it("records session_expired when an expired session is cleaned up", async () => {
    const { auth, database } = await setup();
    await createUser(auth, "student@example.test", "student");
    await signIn(auth, "student@example.test");
    const row = await database
      .updateTable("session")
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .returning(["id", "token"])
      .executeTakeFirstOrThrow();
    const context = await auth.$context;
    await context.internalAdapter.deleteSession(row.token);
    expect(await events(database, "session_expired")).toEqual([
      expect.objectContaining({ actor_type: "system", target_id: row.id }),
    ]);
  });

  it("records authz_role_change with the new role set", async () => {
    const { auth, database } = await setup();
    const { adminId, studentId, headers } = await adminAndStudent(auth);
    await auth.api.setRole({ body: { userId: studentId, role: "teacher" }, headers });
    expect(await events(database, "authz_role_change")).toEqual([
      expect.objectContaining({
        actor_id: adminId,
        target_id: studentId,
        outcome: "success",
        metadata: { roles: "teacher" },
      }),
    ]);
  });

  it("records a refused role change with cannot_change_own_roles (ADR 0012)", async () => {
    const { auth, database } = await setup();
    const { adminId, headers } = await adminAndStudent(auth);
    await expect(
      auth.api.setRole({ body: { userId: adminId, role: ["teacher", "admin"] }, headers }),
    ).rejects.toThrow();
    expect(await events(database, "authz_role_change")).toEqual([
      expect.objectContaining({
        actor_id: adminId,
        target_id: adminId,
        outcome: "refused",
        reason_code: "cannot_change_own_roles",
      }),
    ]);
  });

  it("records a refused role change for a conflicting role set", async () => {
    const { auth, database } = await setup();
    const { studentId, headers } = await adminAndStudent(auth);
    await expect(
      auth.api.setRole({ body: { userId: studentId, role: ["student", "admin"] }, headers }),
    ).rejects.toThrow();
    expect(await events(database, "authz_role_change")).toEqual([
      expect.objectContaining({ outcome: "failure", reason_code: "role_set_not_allowed" }),
    ]);
  });

  it("records a refused admin action by a student", async () => {
    const { auth, database } = await setup();
    const { adminId } = await adminAndStudent(auth);
    const headers = await signIn(auth, "student@example.test");
    await expect(auth.api.banUser({ body: { userId: adminId }, headers })).rejects.toThrow();
    expect(await events(database, "user_banned")).toEqual([
      expect.objectContaining({ target_id: adminId, outcome: "refused" }),
    ]);
  });

  it("records user_deleted", async () => {
    const { auth, database } = await setup();
    const { adminId, studentId, headers } = await adminAndStudent(auth);
    await auth.api.removeUser({ body: { userId: studentId }, headers });
    expect(await events(database, "user_deleted")).toEqual([
      expect.objectContaining({ actor_id: adminId, target_id: studentId, outcome: "success" }),
    ]);
  });
});

describe("context helpers", () => {
  it("reads the provider of a sign-in path", () => {
    expect(providerOf({ path: "/sign-in/email" })).toBe("credential");
    expect(providerOf({ path: "/callback/:id", params: { id: "microsoft" } })).toBe("microsoft");
    expect(
      providerOf({ path: "/oauth2/callback/:providerId", params: { providerId: "keycloak" } }),
    ).toBe("keycloak");
    expect(providerOf({ path: "/callback/:id", params: { id: "github" } })).toBeUndefined();
    expect(providerOf(null)).toBeUndefined();
  });

  it("keeps only a request id of a safe shape", () => {
    expect(requestIdOf({ headers: new Headers({ "x-request-id": "abc-123" }) })).toBe("abc-123");
    expect(requestIdOf({ headers: new Headers({ "x-request-id": "a b;<c>" }) })).toBeUndefined();
    expect(requestIdOf({})).toBeUndefined();
  });

  it("finds no recorder on a context without the plugin", () => {
    expect(auditRecorderOf({})).toBeUndefined();
  });

  it("reuses the test database's Kysely instance", async () => {
    const database = await createTestDb();
    db = database;
    expect(auditDatabase({ db: database, type: "postgres" })).toBe(database);
  });
});
