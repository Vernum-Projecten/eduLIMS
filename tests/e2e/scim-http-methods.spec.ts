// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// SCIM over HTTP against the built server (#365, B4, Q-SEC-2, ASVS V7.4.2): PUT, PATCH and
// DELETE reach better-auth through the `/api/auth/$` server route, not only through
// `auth.handler` as the integration tests call it. The directory deactivates (PATCH or PUT) or
// deletes a signed-in user and every session of that user ends; it replaces a user; it deletes
// a user and a group with the
// status codes of RFC 7644 §3.5.1, §3.5.2 and §3.6; each write is in the activity log. The token belongs to `keycloak-saml`, so
// this file never meets the `keycloak` token of admin-scim.spec.ts. Everything is invented.
import { randomBytes } from "node:crypto";
import { type APIRequestContext, expect, type PlaywrightWorkerArgs, test } from "@playwright/test";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { newId } from "../../src/server/db/ids.ts";
import type { DB } from "../../src/server/db/schema.gen.ts";
import { createScimToken, revokeScimToken } from "../../src/server/scim/tokens.ts";
import { copyAccount } from "./accounts";
import { DEV_PASSWORD } from "./fixtures";
import { appUrl } from "./run-env";

const PROVIDER = "keycloak-saml";
const USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const GROUP_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Group";
const PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
const SCIM_JSON = "application/scim+json";

let db: Kysely<DB>;
let token: string;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const url = process.env["EDULIMS_E2E_DATABASE_URL"];
  if (!url) throw new Error("EDULIMS_E2E_DATABASE_URL is not set; playwright.config.ts sets it.");
  db = new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 1 }) }),
  });
  const ctx = { db, actor: { type: "system" } as const };
  // A token a retry or an earlier run left is revoked first; `no_token` means there was none.
  await revokeScimToken(ctx, PROVIDER);
  const issued = await createScimToken(ctx, PROVIDER);
  if (!issued.ok) throw new Error(`No SCIM token for ${PROVIDER}: ${issued.error}`);
  token = issued.token;
});

test.afterAll(async () => {
  await revokeScimToken({ db, actor: { type: "system" } }, PROVIDER);
  await db.destroy();
});

interface ScimAnswer {
  status: number;
  contentType: string;
  text: string;
  json: Record<string, unknown>;
}

/** Sends one SCIM request with the run's token, as a directory would. */
async function scim(
  request: APIRequestContext,
  method: string,
  path: string,
  body?: unknown,
): Promise<ScimAnswer> {
  const response = await request.fetch(`${appUrl()}/api/auth/scim/v2${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: SCIM_JSON,
      "content-type": SCIM_JSON,
    },
    ...(body === undefined ? {} : { data: JSON.stringify(body) }),
  });
  const text = await response.text();
  const contentType = response.headers()["content-type"] ?? "";
  let json: Record<string, unknown> = {};
  if (contentType.includes("json") && text !== "") {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null) json = { ...parsed };
  }
  return { status: response.status(), contentType, text, json };
}

function userBody(externalId: string, email: string, displayName: string) {
  return {
    schemas: [USER_SCHEMA],
    externalId,
    userName: email,
    displayName,
    name: { givenName: "Noor", familyName: "Brink" },
    emails: [{ value: email, type: "work", primary: true }],
    active: true,
  };
}

function patch(operations: unknown[]) {
  return { schemas: [PATCH_SCHEMA], Operations: operations };
}

function tag(): string {
  return randomBytes(4).toString("hex");
}

/** Returns the eduLIMS user id behind a SCIM User id. */
async function userOf(scimId: string): Promise<string> {
  const row = await db
    .selectFrom("scimUser")
    .select("userId")
    .where("id", "=", scimId)
    .executeTakeFirstOrThrow();
  return row.userId;
}

async function sessionCount(userId: string): Promise<number> {
  const rows = await db.selectFrom("session").select("id").where("userId", "=", userId).execute();
  return rows.length;
}

async function deprovisionedAt(userId: string): Promise<Date | null> {
  const row = await db
    .selectFrom("user")
    .select("deprovisioned_at")
    .where("id", "=", userId)
    .executeTakeFirstOrThrow();
  return row.deprovisioned_at;
}

/** Returns the activity-log actions about one target, oldest first (B4). */
async function loggedActions(targetId: string): Promise<string[]> {
  const rows = await db
    .selectFrom("audit_event")
    .select("action")
    .where("target_id", "=", targetId)
    .orderBy("id")
    .execute();
  return rows.map((row) => row.action);
}

/** Returns the user id of the session the context's cookie holds, or null without one. */
async function sessionUser(request: APIRequestContext): Promise<string | null> {
  const response = await request.get(`${appUrl()}/api/auth/get-session`);
  expect(response.status()).toBe(200);
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null) return null;
  const user: unknown = Reflect.get(body, "user");
  const id: unknown = typeof user === "object" && user !== null ? Reflect.get(user, "id") : null;
  return typeof id === "string" ? id : null;
}

/** A user the directory provisioned and linked, signed in with a session cookie of its own. */
interface SignedInUser {
  userId: string;
  email: string;
  externalId: string;
  scimId: string;
  browser: APIRequestContext;
}

/**
 * Provisions a copy of the dev student over SCIM, linked through the provider account that
 * carries the directory id, and signs it in over HTTP. The caller disposes `browser`.
 */
async function provisionSignedIn(
  playwright: PlaywrightWorkerArgs["playwright"],
  request: APIRequestContext,
  prefix: string,
): Promise<SignedInUser> {
  const account = await copyAccount("student@example.test", prefix);
  const externalId = `e2e-${prefix}-${tag()}`;
  await db
    .insertInto("account")
    .values({
      id: newId(),
      accountId: externalId,
      providerId: PROVIDER,
      userId: account.id,
      updatedAt: new Date(),
    })
    .execute();
  const created = await scim(
    request,
    "POST",
    "/Users",
    userBody(externalId, account.email, "Noor Brink"),
  );
  expect(created.status).toBe(201);
  const scimId = String(created.json["id"]);
  expect(await userOf(scimId)).toBe(account.id);

  const browser = await playwright.request.newContext({ baseURL: appUrl() });
  const signIn = await browser.post(`${appUrl()}/api/auth/sign-in/email`, {
    data: { email: account.email, password: DEV_PASSWORD },
  });
  expect(signIn.status()).toBe(200);
  expect(await sessionUser(browser)).toBe(account.id);
  expect(await sessionCount(account.id)).toBeGreaterThan(0);
  return { userId: account.id, email: account.email, externalId, scimId, browser };
}

/** Asserts that the user is deprovisioned and that no session of theirs is left (V7.4.2). */
async function expectDeprovisioned(user: SignedInUser): Promise<void> {
  expect(await deprovisionedAt(user.userId)).toBeInstanceOf(Date);
  expect(await sessionCount(user.userId)).toBe(0);
  expect(await sessionUser(user.browser)).toBeNull();
  await expect.poll(() => loggedActions(user.userId)).toContain("user_deprovisioned");
}

test("a SCIM PATCH active:false deprovisions a signed-in user and ends their sessions (V7.4.2)", async ({
  playwright,
  request,
}) => {
  const user = await provisionSignedIn(playwright, request, "scim-patch");
  try {
    const off = await scim(
      request,
      "PATCH",
      `/Users/${user.scimId}`,
      patch([{ op: "replace", path: "active", value: false }]),
    );
    // RFC 7644 §3.5.2: 200 with the entire resource (or 204); never the app's HTML or a 406.
    expect(off.status).toBe(200);
    expect(off.contentType).toContain("json");
    expect(off.json["id"]).toBe(user.scimId);
    expect(off.json["active"]).toBe(false);
    await expectDeprovisioned(user);
    await expect.poll(() => loggedActions(user.scimId)).toContain("scim_user_updated");
  } finally {
    await user.browser.dispose();
  }
});

test("a SCIM PUT with active:false deprovisions a signed-in user and ends their sessions (V7.4.2)", async ({
  playwright,
  request,
}) => {
  // Okta deactivates a user with a PUT of the whole resource.
  const user = await provisionSignedIn(playwright, request, "scim-put-off");
  try {
    const off = await scim(request, "PUT", `/Users/${user.scimId}`, {
      ...userBody(user.externalId, user.email, "Noor Brink"),
      active: false,
    });
    expect(off.status).toBe(200);
    expect(off.json["id"]).toBe(user.scimId);
    expect(off.json["active"]).toBe(false);
    await expectDeprovisioned(user);
  } finally {
    await user.browser.dispose();
  }
});

test("a SCIM PUT replaces a user (RFC 7644 §3.5.1)", async ({ request }) => {
  const email = `scim-put-${tag()}@example.test`;
  const externalId = `e2e-put-${tag()}`;
  const created = await scim(request, "POST", "/Users", userBody(externalId, email, "Noor Brink"));
  expect(created.status).toBe(201);
  const scimId = String(created.json["id"]);

  const replaced = await scim(request, "PUT", `/Users/${scimId}`, {
    ...userBody(externalId, email, "Noor van den Brink"),
    name: { givenName: "Noor", familyName: "van den Brink" },
  });
  expect(replaced.status).toBe(200);
  expect(replaced.contentType).toContain("json");
  expect(replaced.json["id"]).toBe(scimId);
  expect(replaced.json["displayName"]).toBe("Noor van den Brink");

  const read = await scim(request, "GET", `/Users/${scimId}`);
  expect(read.status).toBe(200);
  expect(read.json["displayName"]).toBe("Noor van den Brink");
  const user = await db
    .selectFrom("user")
    .select("name")
    .where("id", "=", await userOf(scimId))
    .executeTakeFirstOrThrow();
  expect(user.name).toBe("Noor van den Brink");
  await expect.poll(() => loggedActions(scimId)).toContain("scim_user_updated");
});

test("a SCIM DELETE of a signed-in user answers 204, ends their sessions, and the user is gone from SCIM (RFC 7644 §3.6)", async ({
  playwright,
  request,
}) => {
  const user = await provisionSignedIn(playwright, request, "scim-delete");
  try {
    const deleted = await scim(request, "DELETE", `/Users/${user.scimId}`);
    expect(deleted.status).toBe(204);
    expect(deleted.text).toBe("");

    expect((await scim(request, "GET", `/Users/${user.scimId}`)).status).toBe(404);
    const filter = encodeURIComponent(`userName eq "${user.email}"`);
    const listed = await scim(request, "GET", `/Users?filter=${filter}`);
    expect(listed.status).toBe(200);
    expect(listed.json["totalResults"]).toBe(0);
    // The eduLIMS user stays, deprovisioned: no sign-in and no erasure (#47).
    await expectDeprovisioned(user);
    await expect.poll(() => loggedActions(user.scimId)).toContain("scim_user_deleted");
  } finally {
    await user.browser.dispose();
  }
});

test("a SCIM DELETE of a group answers 204, and the group is gone (RFC 7644 §3.6)", async ({
  request,
}) => {
  const created = await scim(request, "POST", "/Groups", {
    schemas: [GROUP_SCHEMA],
    externalId: `e2e-group-${tag()}`,
    displayName: `Bench staff ${tag()}`,
  });
  expect(created.status).toBe(201);
  const groupId = String(created.json["id"]);

  const deleted = await scim(request, "DELETE", `/Groups/${groupId}`);
  expect(deleted.status).toBe(204);
  expect(deleted.text).toBe("");
  expect((await scim(request, "GET", `/Groups/${groupId}`)).status).toBe(404);
  await expect.poll(() => loggedActions(groupId)).toContain("scim_group_deleted");
});
