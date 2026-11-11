// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The identity-provider admin service on a real PostgreSQL 18, for the findings of the #46
// security review: the PKCE attestation (H1), a client secret that never follows a moved issuer
// (M1), and the sessions a disabled provider ends (M4).
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { dataKey } from "./crypto.ts";
import { invalidateProviderCache } from "./registry.ts";
import type { CreateProviderInput } from "./schemas.ts";
import {
  createProvider,
  type IdpServiceContext,
  setProviderEnabled,
  updateProvider,
} from "./service.ts";

const ISSUER = "https://login.example.test/tenant/v2.0";
let db: Kysely<DB> | undefined;

afterEach(async () => {
  vi.unstubAllGlobals();
  invalidateProviderCache();
  await db?.destroy();
  db = undefined;
});

/** Stubs discovery for {@link ISSUER}; `pkce` is its `code_challenge_methods_supported`, `null` for none. */
function stubDiscovery(pkce: string[] | null): void {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== `${ISSUER}/.well-known/openid-configuration`) {
      return new Response(null, { status: 404 });
    }
    return Response.json({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      jwks_uri: `${ISSUER}/keys`,
      ...(pkce ? { code_challenge_methods_supported: pkce } : {}),
    });
  });
}

async function setup(pkce: string[] | null = ["S256"]) {
  db = await createTestDb();
  stubDiscovery(pkce);
  const ctx: IdpServiceContext = {
    db,
    keyring: { current: dataKey(Buffer.alloc(32, 9).toString("base64")), previous: null },
    policy: { production: false, privateOrigins: [], resolve: async () => ["93.184.215.14"] },
    baseURL: "https://edulims.example",
    actor: { type: "system" },
  };
  return { ctx, database: db };
}

const OIDC = {
  providerId: "entra",
  protocol: "oidc",
  settings: {
    labelEn: "Entra ID",
    labelNl: "Entra ID",
    icon: "building",
    sortOrder: 0,
    roleClaim: "roles",
    roleMap: [{ value: "edulims-teacher", role: "teacher" }],
    defaultRole: null,
    emailAuthoritative: false,
    domains: [],
  },
  oidc: { issuer: ISSUER, clientId: "client-1", clientSecret: "secret-1", attestPkce: false },
} satisfies CreateProviderInput;

async function actions(database: Kysely<DB>) {
  const rows = await database
    .selectFrom("audit_event")
    .select(["action", "metadata"])
    .orderBy("occurred_at")
    .orderBy("id")
    .execute();
  return rows;
}

describe("PKCE attestation (H1, ASVS V10.2.1)", () => {
  it("refuses an IdP whose discovery document lists no PKCE methods, and writes nothing", async () => {
    const { ctx, database } = await setup(null);
    expect(await createProvider(ctx, OIDC)).toEqual({ ok: false, error: "no_pkce" });
    expect(await database.selectFrom("ssoProvider").select("id").execute()).toEqual([]);
    expect(await actions(database)).toEqual([]);
  });

  it("accepts it with the attestation, stores it, and logs it", async () => {
    const { ctx, database } = await setup(null);
    const attested = { ...OIDC, oidc: { ...OIDC.oidc, attestPkce: true } };
    expect(await createProvider(ctx, attested)).toEqual({ ok: true, providerId: "entra" });
    const row = await database
      .selectFrom("identity_provider")
      .select("attest_pkce")
      .executeTakeFirstOrThrow();
    expect(row.attest_pkce).toBe(true);
    expect(await actions(database)).toEqual([
      {
        action: "idp_created",
        metadata: { provider_id: "entra", protocol: "oidc", attest_pkce: true },
      },
    ]);
  });

  it("records turning the attestation on as a changed field", async () => {
    const { ctx, database } = await setup(["S256"]);
    await createProvider(ctx, OIDC);
    await updateProvider(ctx, {
      ...OIDC,
      oidc: { ...OIDC.oidc, clientSecret: "", attestPkce: true },
    });
    expect((await actions(database)).at(-1)).toEqual({
      action: "idp_updated",
      metadata: { provider_id: "entra", protocol: "oidc", fields: ["attest_pkce"] },
    });
  });
});

describe("a moved issuer (M1)", () => {
  it("refuses to keep the stored secret for an issuer on another origin, and writes nothing", async () => {
    const { ctx, database } = await setup();
    await createProvider(ctx, OIDC);
    const moved = {
      ...OIDC,
      oidc: { ...OIDC.oidc, issuer: "https://idp.elsewhere.example/realm", clientSecret: "" },
    };
    expect(await updateProvider(ctx, moved)).toEqual({
      ok: false,
      error: "client_secret_required",
    });
    expect((await actions(database)).map((row) => row.action)).toEqual(["idp_created"]);
    const stored = await database.selectFrom("ssoProvider").select("issuer").executeTakeFirst();
    expect(stored?.issuer).toBe(ISSUER);
  });

  it("keeps the stored secret when the issuer stays on its origin", async () => {
    const { ctx } = await setup();
    await createProvider(ctx, OIDC);
    expect(
      await updateProvider(ctx, { ...OIDC, oidc: { ...OIDC.oidc, clientSecret: "" } }),
    ).toEqual({ ok: true, providerId: "entra" });
  });
});

describe("disabling a provider (M4, ASVS V7.4.2)", () => {
  it("ends every session of its users in the same change and logs how many", async () => {
    const { ctx, database } = await setup();
    await createProvider(ctx, OIDC);
    await setProviderEnabled(ctx, { providerId: "entra", enabled: true });
    const now = new Date();
    const later = new Date(now.getTime() + 3_600_000);
    await database
      .insertInto("user")
      .values([
        { id: "u1", name: "U1", email: "u1@example.test", emailVerified: true },
        { id: "u2", name: "U2", email: "u2@example.test", emailVerified: true },
      ])
      .execute();
    await database
      .insertInto("account")
      .values([
        {
          id: "a1",
          accountId: "s1",
          providerId: "entra",
          userId: "u1",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "a2",
          accountId: "u2",
          providerId: "credential",
          userId: "u2",
          createdAt: now,
          updatedAt: now,
        },
      ])
      .execute();
    await database
      .insertInto("session")
      .values([
        { id: "s1", token: "t1", userId: "u1", expiresAt: later, updatedAt: now },
        { id: "s2", token: "t2", userId: "u1", expiresAt: later, updatedAt: now },
        { id: "s3", token: "t3", userId: "u2", expiresAt: later, updatedAt: now },
      ])
      .execute();
    expect(await setProviderEnabled(ctx, { providerId: "entra", enabled: false })).toEqual({
      ok: true,
      providerId: "entra",
    });
    const left = await database.selectFrom("session").select("id").orderBy("id").execute();
    expect(left).toEqual([{ id: "s3" }]);
    expect((await actions(database)).at(-1)).toEqual({
      action: "idp_disabled",
      metadata: { provider_id: "entra", protocol: "oidc", sessions_ended: 2 },
    });
  });
});
