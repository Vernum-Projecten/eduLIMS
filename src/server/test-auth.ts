// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Test support: a better-auth instance on a test database whose schema check has already run.
// better-auth 1.7.20 checks the schema on an instance's first request; run lazily, that check
// can outlive a test and query its rolled-back database, so tests settle it up front.
// NOTE: #236; better-auth's tanstackStartCookies hook imports this lazily on the first response
// that sets a cookie. The app server has it loaded at startup; a test worker loaded its hundreds
// of modules from disk inside the first sign-in test's timeout, so it loads with this module.
import "@tanstack/react-start/server";
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
