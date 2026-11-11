// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Test support: a better-auth instance on a test database whose schema check has already run.
// better-auth 1.7.20 checks the schema on an instance's first request; run lazily, that check
// can outlive a test and query its rolled-back database, so tests settle it up front.
import { type AuthDatabase, createAuth } from "./auth.ts";
import type { Env } from "./env.ts";

/** Creates the auth instance of a test and waits for its schema check. */
export async function createTestAuth(env: Env, database: AuthDatabase) {
  const auth = createAuth(env, database);
  const context: unknown = await auth.$context;
  const check: unknown = Reflect.get(Object(context), "checkSchema");
  if (typeof check === "function") await Reflect.apply(check, context, []);
  return auth;
}
