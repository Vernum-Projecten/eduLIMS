// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Shared setup of the Users screen's database tests: a better-auth instance on the rolled-back
// test database and signed-in sessions of fictional @example.test people.
import { randomBytes } from "node:crypto";
import type { Kysely } from "kysely";
import { formatRoles, type Role } from "../../lib/roles.ts";
import type { Auth } from "../auth.ts";
import type { SessionUser } from "../authz.ts";
import { newId } from "../db/ids.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { parseEnv } from "../env.ts";
import { createTestAuth } from "../test-auth.ts";
import { VALID_ENV } from "../test-env.ts";
import type { ActionContext } from "./actions.ts";

/** The password of every user these helpers create, new for each test run. */
export const TEST_PASSWORD = randomBytes(18).toString("base64url");

/** A test database and a better-auth instance on it. */
export async function authOnTestDb(): Promise<{ auth: Auth; db: Kysely<DB> }> {
  const db = await createTestDb();
  const auth = await createTestAuth(parseEnv({ ...VALID_ENV, EDULIMS_DEV_LOGIN: "true" }), {
    db,
    type: "postgres",
  });
  return { auth, db };
}

/** Creates a password user with `roles` and returns its id. */
export async function createUser(auth: Auth, email: string, roles: readonly Role[]) {
  const { user } = await auth.api.createUser({
    body: { email, name: `Test ${email.split("@")[0]}`, password: TEST_PASSWORD, role: [...roles] },
  });
  return user.id;
}

/** Signs `email` in and returns the request headers of that session. */
export async function signIn(auth: Auth, email: string): Promise<Headers> {
  const response = await auth.api.signInEmail({
    body: { email, password: TEST_PASSWORD },
    asResponse: true,
  });
  if (!response.ok) throw new Error(`sign-in failed with ${response.status}`);
  const cookie = response.headers.getSetCookie().map((c) => c.split(";")[0]);
  return new Headers({ cookie: cookie.join("; ") });
}

/**
 * Inserts a user with `roles`, a credential account and one live session, straight into the
 * tables, and returns the user id. No password is hashed, so a test that needs many users with
 * accounts and sessions (the committed-database races of #318) stays fast on a busy runner.
 */
export async function insertSignedInUser(
  db: Kysely<DB>,
  email: string,
  roles: readonly Role[],
): Promise<string> {
  const id = newId();
  const now = new Date();
  await db
    .insertInto("user")
    .values({
      id,
      name: `Test ${email.split("@")[0]}`,
      email,
      emailVerified: true,
      role: formatRoles(roles),
    })
    .execute();
  await db
    .insertInto("account")
    .values({ id: newId(), accountId: id, providerId: "credential", userId: id, updatedAt: now })
    .execute();
  await db
    .insertInto("session")
    .values({
      id: newId(),
      token: newId(),
      userId: id,
      expiresAt: new Date(now.getTime() + 3_600_000),
      updatedAt: now,
    })
    .execute();
  return id;
}

/** Creates a user with `roles`, signs them in, and returns the action context of that actor. */
export async function signedInActor(
  auth: Auth,
  db: Kysely<DB>,
  email: string,
  roles: readonly Role[],
): Promise<ActionContext & { actor: SessionUser }> {
  const id = await createUser(auth, email, roles);
  const headers = await signIn(auth, email);
  return {
    auth,
    db,
    headers,
    now: new Date(),
    actor: { id, name: "Test", email, roles, lastPortal: null },
  };
}
