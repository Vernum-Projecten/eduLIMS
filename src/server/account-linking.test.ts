// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Cross-provider account linking is off (#39, ASVS V6.8.1). These tests run a real Entra ID
// callback through better-auth with the token endpoint stubbed at the HTTP layer, against a
// user who already signs in through Keycloak.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ACCOUNT_NOT_LINKED_ERROR } from "../lib/identity-providers.ts";
import { createAuth } from "./auth.ts";
import type { DB } from "./db/schema.gen.ts";
import { createTestDb } from "./db/test-db.ts";
import { parseEnv } from "./env.ts";
import { VALID_ENV } from "./test-env.ts";

const BASE = VALID_ENV.BETTER_AUTH_URL;
const KEYCLOAK = {
  KEYCLOAK_ISSUER: "https://idp.example/realms/edulims",
  KEYCLOAK_CLIENT_ID: "edulims",
  KEYCLOAK_CLIENT_SECRET: "kc-secret",
};
const EMAIL = "teacher@example.test";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  vi.unstubAllGlobals();
  await db?.destroy();
  db = undefined;
});

/** An unsigned JWT: the Entra ID provider decodes the ID token it got over TLS from the token endpoint. */
function idToken(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "none", typ: "JWT" })}.${part(claims)}.`;
}

/** Answers the Entra ID token endpoint with an ID token for `email`; every other URL is a 404. */
function stubMicrosoftTokenEndpoint(email: string): void {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.includes("/oauth2/v2.0/token")) return new Response(null, { status: 404 });
    const token = idToken({
      oid: "00000000-0000-0000-0000-0000000000aa",
      sub: "entra-subject",
      email,
      email_verified: true,
      name: "Test Teacher",
      roles: ["edulims-teacher"],
    });
    return Response.json({
      access_token: "entra-access-token",
      id_token: token,
      token_type: "Bearer",
      expires_in: 3600,
    });
  });
}

async function setup() {
  db = await createTestDb();
  const auth = createAuth(parseEnv({ ...VALID_ENV, ...KEYCLOAK }), { db, type: "postgres" });
  return { auth, database: db };
}

/** Creates a user who signs in through Keycloak, with that account row only. */
async function keycloakUser(database: Kysely<DB>): Promise<string> {
  const now = new Date();
  const id = "kc-user-1";
  await database
    .insertInto("user")
    .values({
      id,
      name: "Test Teacher",
      email: EMAIL,
      emailVerified: true,
      role: "teacher",
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  await database
    .insertInto("account")
    .values({
      id: "kc-account-1",
      accountId: "keycloak-subject",
      providerId: "keycloak",
      userId: id,
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  return id;
}

/** Starts an Entra ID sign-in and completes its callback; returns the final redirect. */
async function signInWithMicrosoft(auth: ReturnType<typeof createAuth>) {
  const start = await auth.handler(
    new Request(`${BASE}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE },
      body: JSON.stringify({ provider: "microsoft", callbackURL: "/", errorCallbackURL: "/login" }),
    }),
  );
  const { url } = z.object({ url: z.url() }).parse(await start.json());
  const state = new URL(url).searchParams.get("state");
  const cookie = start.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const callback = await auth.handler(
    new Request(`${BASE}/api/auth/callback/microsoft?code=entra-code&state=${state}`, {
      headers: { cookie },
    }),
  );
  return {
    location: callback.headers.get("location") ?? "",
    setCookies: callback.headers.getSetCookie(),
  };
}

describe("cross-provider account linking (#39, ASVS V6.8.1)", () => {
  it("refuses an Entra ID sign-in with the email of a Keycloak user", async () => {
    const { auth, database } = await setup();
    const userId = await keycloakUser(database);
    stubMicrosoftTokenEndpoint(EMAIL);

    const { location, setCookies } = await signInWithMicrosoft(auth);

    expect(new URL(location, BASE).pathname).toBe("/login");
    expect(new URL(location, BASE).searchParams.get("error")).toBe(ACCOUNT_NOT_LINKED_ERROR);
    expect(setCookies.filter((cookie) => /session_token=[^;]/.test(cookie))).toEqual([]);
    const accounts = await database
      .selectFrom("account")
      .select("providerId")
      .where("userId", "=", userId)
      .execute();
    expect(accounts).toEqual([{ providerId: "keycloak" }]);
    const sessions = await database.selectFrom("session").select("id").execute();
    expect(sessions).toEqual([]);
  });

  it("still signs in a new Entra ID user, so the refusal above is not a broken stub", async () => {
    const { auth, database } = await setup();
    stubMicrosoftTokenEndpoint("new-teacher@example.test");

    const { location } = await signInWithMicrosoft(auth);

    expect(new URL(location, BASE).searchParams.get("error")).toBeNull();
    const user = await database
      .selectFrom("user")
      .select("id")
      .where("email", "=", "new-teacher@example.test")
      .executeTakeFirst();
    expect(user).toBeDefined();
  });
});
