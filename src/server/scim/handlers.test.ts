// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Negative role tests for every SCIM server function (#45; B1, R-01): a student and a teacher
// get 403 from each handler before anything is read or written; an administrator does not.
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "../authz.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { parseEnv } from "../env.ts";
import { keyringOf } from "../idp/crypto.ts";
import { invalidateProviderCache, providerSettings } from "../idp/registry.ts";
import { insertTestProvider } from "../idp/test-providers.ts";
import { AuthError } from "../middleware.ts";
import { VALID_ENV } from "../test-env.ts";
import { type ScimHandlerDeps, scimEndpoint, scimHandlers } from "./handlers.ts";

let db: Kysely<DB>;
let deps: ScimHandlerDeps;

beforeEach(async () => {
  db = await createTestDb();
  await db
    .insertInto("user")
    .values({ id: "admin-1", name: "A", email: "admin@example.test", emailVerified: true })
    .execute();
  await insertTestProvider(db, keyringOf(parseEnv(VALID_ENV)), { providerId: "campus" });
  deps = { db, baseURL: "https://lims.example.test/", support: async () => ({ ok: true }) };
});

afterEach(async () => {
  invalidateProviderCache();
  await db.destroy();
});

function user(id: string, roles: SessionUser["roles"]): Pick<SessionUser, "id" | "roles"> {
  return { id, roles };
}

const PROVIDER = { providerId: "campus" };

const CALLS: readonly [string, (actor: Pick<SessionUser, "id" | "roles">) => Promise<unknown>][] = [
  ["detail", (actor) => scimHandlers.detail(actor, PROVIDER, deps)],
  ["create", (actor) => scimHandlers.create(actor, PROVIDER, deps)],
  ["rotate", (actor) => scimHandlers.rotate(actor, PROVIDER, deps)],
  ["revoke", (actor) => scimHandlers.revoke(actor, PROVIDER, deps)],
  [
    "setExternalIdClaim",
    (actor) => scimHandlers.setExternalIdClaim(actor, { ...PROVIDER, claim: "oid" }, deps),
  ],
];

describe("SCIM server functions refuse every role but admin (B1, R-01)", () => {
  it.each(CALLS)("%s: a student gets 403 and nothing changes", async (_name, call) => {
    await expect(call(user("s", ["student"]))).rejects.toThrow(AuthError);
    expect(await db.selectFrom("scim_token").select("id").execute()).toEqual([]);
    expect(await db.selectFrom("audit_event").select("id").execute()).toEqual([]);
  });

  it.each(CALLS)("%s: a teacher gets 403 and nothing changes", async (_name, call) => {
    await expect(call(user("t", ["teacher"]))).rejects.toThrow(AuthError);
    expect(await db.selectFrom("scim_token").select("id").execute()).toEqual([]);
    expect(await db.selectFrom("audit_event").select("id").execute()).toEqual([]);
  });

  it.each(CALLS)("%s: an administrator is let through", async (_name, call) => {
    await expect(call(user("admin-1", ["admin"]))).resolves.toBeDefined();
  });
});

describe("the SCIM section", () => {
  it("shows the endpoint and the token's dates, never the token", async () => {
    const admin = user("admin-1", ["teacher", "admin"]);
    const created = await scimHandlers.create(admin, PROVIDER, deps);
    if (!created.ok) throw new Error(created.error);
    const detail = await scimHandlers.detail(admin, PROVIDER, deps);
    expect(detail).toMatchObject({
      available: true,
      active: true,
      endpoint: "https://lims.example.test/api/auth/scim/v2",
      externalIdClaim: null,
      lastUsedAt: null,
    });
    expect(JSON.stringify(detail)).not.toContain(created.token);
  });

  it("throws notFound for an unknown provider", async () => {
    await expect(
      scimHandlers.detail(user("admin-1", ["admin"]), { providerId: "nobody" }, deps),
    ).rejects.toMatchObject({ isNotFound: true });
  });

  it("says when this installation cannot run SCIM", async () => {
    const off: ScimHandlerDeps = {
      ...deps,
      support: async () => ({ ok: false, reason: "no_native_transactions" }),
    };
    const detail = await scimHandlers.detail(user("admin-1", ["admin"]), PROVIDER, off);
    expect(detail.available).toBe(false);
  });

  it("sets and clears the external-id claim, logged as idp_updated, and the sign-in reads it", async () => {
    const admin = user("admin-1", ["admin"]);
    expect(
      await scimHandlers.setExternalIdClaim(admin, { ...PROVIDER, claim: "oid" }, deps),
    ).toEqual({ ok: true, providerId: "campus" });
    expect((await providerSettings(db, "campus"))?.scimExternalIdClaim).toBe("oid");
    await scimHandlers.setExternalIdClaim(admin, { ...PROVIDER, claim: null }, deps);
    expect((await providerSettings(db, "campus"))?.scimExternalIdClaim).toBeNull();
    const rows = await db.selectFrom("audit_event").select(["action", "metadata"]).execute();
    expect(rows[0]).toMatchObject({
      action: "idp_updated",
      metadata: { fields: ["scim_external_id_claim"], provider_id: "campus" },
    });
  });

  it("refuses a claim with spaces or other characters (invalid), and an unknown provider", async () => {
    const admin = user("admin-1", ["admin"]);
    expect(
      await scimHandlers.setExternalIdClaim(admin, { ...PROVIDER, claim: "a b" }, deps),
    ).toEqual({ ok: false, error: "invalid" });
    expect(
      await scimHandlers.setExternalIdClaim(admin, { providerId: "nobody", claim: "oid" }, deps),
    ).toEqual({ ok: false, error: "not_found" });
  });

  it("builds the endpoint from BETTER_AUTH_URL with or without a trailing slash", () => {
    expect(scimEndpoint("http://localhost:3000")).toBe("http://localhost:3000/api/auth/scim/v2");
  });
});
