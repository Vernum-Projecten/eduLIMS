// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// A real OIDC sign-in through the development Keycloak lands on the user SCIM provisioned
// (#45, ADR 0017): the sso plugin's `resolveUser` links on the directory externalId (here the
// Keycloak subject, the account key), never on email, and a user the directory deactivated is
// refused with `account_deprovisioned`. Skipped when that Keycloak is not reachable (CI).
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Auth } from "../../src/server/auth.ts";
import type { DB } from "../../src/server/db/schema.gen.ts";
import { devKeycloakRealm, seedDevProviders } from "../../src/server/db/seed-providers.ts";
import { createTestDb } from "../../src/server/db/test-db.ts";
import { parseEnv } from "../../src/server/env.ts";
import { keyringOf } from "../../src/server/idp/crypto.ts";
import { createScimToken } from "../../src/server/scim/tokens.ts";
import { createTestAuth } from "../../src/server/test-auth.ts";
import { VALID_ENV } from "../../src/server/test-env.ts";
import { CookieJar, keycloakLogin, keycloakReachable } from "./sso-flow.ts";

const BASE = "http://localhost:3000";
const REALM = process.env["EDULIMS_IT_KEYCLOAK_REALM"]?.trim() || devKeycloakRealm();
const ready = await keycloakReachable(REALM);

describe.skipIf(!ready)("SSO sign-in of a SCIM-provisioned user (#45)", () => {
  let db: Kysely<DB>;
  let auth: Auth;
  let token: string;

  beforeAll(async () => {
    db = await createTestDb();
    const env = parseEnv({
      ...VALID_ENV,
      BETTER_AUTH_URL: BASE,
      EDULIMS_IDP_PRIVATE_ORIGINS: new URL(REALM).origin,
    });
    auth = await createTestAuth(env, { db, type: "postgres" });
    await seedDevProviders(
      db,
      {
        db,
        keyring: keyringOf(env),
        policy: { production: false, privateOrigins: env.EDULIMS_IDP_PRIVATE_ORIGINS },
        baseURL: BASE,
        actor: { type: "system" },
      },
      REALM,
    );
    const issued = await createScimToken({ db, actor: { type: "system" } }, "keycloak");
    if (!issued.ok) throw new Error("no SCIM token");
    token = issued.token;
  });

  afterAll(async () => {
    await db?.destroy();
  });

  async function signIn(username: string) {
    const jar = new CookieJar();
    const started = await auth.handler(
      new Request(`${BASE}/api/auth/sign-in/sso`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE },
        body: JSON.stringify({ providerId: "keycloak", callbackURL: "/login" }),
      }),
    );
    jar.store(started);
    const url: unknown = Reflect.get(Object(await started.json()), "url");
    if (typeof url !== "string") throw new Error("no sign-in URL");
    const keycloak = await keycloakLogin(url, username);
    const callback = keycloak.headers.get("location") ?? "";
    const response = await auth.handler(
      new Request(callback, { headers: { cookie: jar.header() } }),
    );
    jar.store(response);
    const location = new URL(response.headers.get("location") ?? "/", BASE);
    return { error: location.searchParams.get("error"), signedIn: jar.has("session_token") };
  }

  async function scim(method: string, path: string, body?: unknown) {
    const response = await auth.handler(
      new Request(`${BASE}/api/auth/scim/v2${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/scim+json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    const text = await response.text();
    return {
      status: response.status,
      json: text ? (JSON.parse(text) as Record<string, unknown>) : {},
    };
  }

  function scimUser(externalId: string, email: string) {
    return {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      externalId,
      userName: email,
      displayName: "Provisioned teacher",
      emails: [{ value: email, primary: true }],
      active: true,
    };
  }

  it("links the sign-in to the provisioned user on the externalId, then refuses it once deactivated", async () => {
    // A first sign-in reveals the realm user's subject; that user is then removed, so the
    // directory provisions them afresh before their next sign-in.
    expect(await signIn("teacher")).toEqual({ error: null, signedIn: true });
    const first = await db
      .selectFrom("account")
      .innerJoin("user", "user.id", "account.userId")
      .select(["account.accountId", "user.id"])
      .where("user.email", "=", "teacher@edulims.test")
      .executeTakeFirstOrThrow();
    await db.deleteFrom("user").where("id", "=", first.id).execute();

    const created = await scim("POST", "/Users", scimUser(first.accountId, "teacher@edulims.test"));
    expect(created.status).toBe(201);
    const scimId = String(created.json["id"]);
    const provisioned = await db
      .selectFrom("scimUser")
      .select("userId")
      .where("id", "=", scimId)
      .executeTakeFirstOrThrow();

    expect(await signIn("teacher")).toEqual({ error: null, signedIn: true });
    const account = await db
      .selectFrom("account")
      .select("userId")
      .where("providerId", "=", "keycloak")
      .where("accountId", "=", first.accountId)
      .executeTakeFirstOrThrow();
    expect(account.userId).toBe(provisioned.userId);

    const off = {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [{ op: "replace", path: "active", value: false }],
    };
    expect((await scim("PATCH", `/Users/${scimId}`, off)).status).toBe(200);
    expect(await signIn("teacher")).toEqual({ error: "account_deprovisioned", signedIn: false });
  });

  it("never links on email: another externalId with the same email is not this user", async () => {
    const created = await scim(
      "POST",
      "/Users",
      scimUser("not-the-subject", "student@edulims.test"),
    );
    expect(created.status).toBe(201);
    const result = await signIn("student");
    expect(result.signedIn).toBe(false);
    expect(result.error?.replaceAll(" ", "_")).toBe("account_not_linked");
  });
});
