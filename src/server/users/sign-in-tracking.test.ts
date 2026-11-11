// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { LAST_SIGN_IN_METHOD_COOKIE } from "../../lib/sign-in-method.ts";
import type { DB } from "../db/schema.gen.ts";
import { signInMethodOf } from "./sign-in-tracking.ts";
import { authOnTestDb, createUser, TEST_PASSWORD } from "./test-helpers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

describe("signInMethodOf", () => {
  it("names the provider of an OAuth callback and the development login", () => {
    expect(signInMethodOf({ path: "/callback/:id", params: { id: "microsoft" } })).toBe(
      "microsoft",
    );
    expect(
      signInMethodOf({ path: "/oauth2/callback/:providerId", params: { providerId: "keycloak" } }),
    ).toBe("keycloak");
    expect(signInMethodOf({ path: "/sign-in/email" })).toBe("credential");
  });

  it("returns null for other paths and unknown providers", () => {
    expect(signInMethodOf({ path: "/callback/:id", params: { id: "github" } })).toBeNull();
    expect(signInMethodOf({ path: "/get-session" })).toBeNull();
    expect(signInMethodOf(null)).toBeNull();
  });
});

describe("the hint cookie's name (#43)", () => {
  it("is __Host- prefixed over https and bare over plain http", async () => {
    const { lastSignInMethod } = await import("./sign-in-tracking.ts");
    expect(lastSignInMethod("https://edulims.example").options?.cookieName).toBe(
      "__Host-EDULIMS_LAST_SIGN_IN_METHOD",
    );
    expect(lastSignInMethod("http://localhost:3000").options?.cookieName).toBe(
      "EDULIMS_LAST_SIGN_IN_METHOD",
    );
  });
});

describe("the last sign-in (#34)", () => {
  it("stores the method and the time, and sets the hint cookie", async () => {
    const env = await authOnTestDb();
    db = env.db;
    const id = await createUser(env.auth, "teacher@example.test", ["teacher"]);
    const before = await env.db
      .selectFrom("user")
      .select(["last_sign_in_at", "last_login_method"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(before).toEqual({ last_sign_in_at: null, last_login_method: null });

    const response = await env.auth.api.signInEmail({
      body: { email: "teacher@example.test", password: TEST_PASSWORD },
      asResponse: true,
    });
    const hint = response.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith(`${LAST_SIGN_IN_METHOD_COOKIE}=`));
    expect(hint).toMatch(/^EDULIMS_LAST_SIGN_IN_METHOD=credential;/);
    expect(hint).not.toMatch(/HttpOnly/i);

    const after = await env.db
      .selectFrom("user")
      .select(["last_sign_in_at", "last_login_method"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(after.last_login_method).toBe("credential");
    expect(after.last_sign_in_at).toBeInstanceOf(Date);
  });
});
