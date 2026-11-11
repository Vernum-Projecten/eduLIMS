// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The identity-provider admin service on a real PostgreSQL 18 (#46, ADR 0015): both tables
// written together with their activity-log row, secrets sealed at rest and never returned, and
// the refusals (an existing id, a taken domain, accounts, the last enabled provider).
import { readFileSync } from "node:fs";
import { type Kysely, sql } from "kysely";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { parseEnv } from "../env.ts";
import { setSecurityLogWriter } from "../security-log.ts";
import { createTestAuth } from "../test-auth.ts";
import { VALID_ENV } from "../test-env.ts";
import { dataKey, isEnvelope } from "./crypto.ts";
import { listProviders, providerDetail } from "./queries.ts";
import {
  enabledProviders,
  hasDomainRouting,
  invalidateProviderCache,
  providerForEmail,
  providerLabels,
  providerSettings,
} from "./registry.ts";
import type { CreateProviderInput } from "./schemas.ts";

/** Reads one key of a parsed log line. */
function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

import {
  createProvider,
  deleteProvider,
  type IdpServiceContext,
  setProviderEnabled,
  updateProvider,
} from "./service.ts";

const METADATA = readFileSync(
  new URL("../../../tests/fixtures/idp/saml-idp-metadata.xml", import.meta.url),
  "utf8",
);
const ISSUER = "https://login.example.test/tenant/v2.0";
const KEY = Buffer.alloc(32, 7).toString("base64");
const SECRET = "entra-client-secret-value";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  vi.unstubAllGlobals();
  invalidateProviderCache();
  await db?.destroy();
  db = undefined;
});

function stubDiscovery(): void {
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
      end_session_endpoint: `${ISSUER}/logout`,
      code_challenge_methods_supported: ["S256"],
    });
  });
}

async function setup(production = false) {
  db = await createTestDb();
  stubDiscovery();
  const ctx: IdpServiceContext = {
    db,
    keyring: { current: dataKey(KEY), previous: null },
    policy: { production, privateOrigins: [], resolve: async () => ["93.184.215.14"] },
    baseURL: "https://edulims.example",
    actor: { type: "system" },
  };
  return { ctx, database: db };
}

const SETTINGS = {
  labelEn: "Entra ID",
  labelNl: "Entra ID (instelling)",
  icon: "building",
  sortOrder: 1,
  roleClaim: "roles",
  roleMap: [
    { value: "edulims-teacher", role: "teacher" },
    { value: "edulims-admin", role: "admin" },
  ],
  defaultRole: null,
  emailAuthoritative: true,
  domains: ["example.edu"],
} satisfies CreateProviderInput["settings"];

const OIDC: CreateProviderInput = {
  providerId: "entra",
  protocol: "oidc",
  settings: SETTINGS,
  oidc: { issuer: ISSUER, clientId: "client-1", clientSecret: SECRET, attestPkce: false },
};

const SAML: CreateProviderInput = {
  providerId: "campus-saml",
  protocol: "saml",
  settings: { ...SETTINGS, labelEn: "Campus", labelNl: "Campus", roleClaim: "Role", domains: [] },
  saml: { metadataXml: METADATA, metadataUrl: "", spPrivateKey: "" },
};

async function auditRows(database: Kysely<DB>) {
  return database
    .selectFrom("audit_event")
    .select(["action", "actor_type", "target_type", "target_id", "metadata"])
    .orderBy("occurred_at")
    .orderBy("id")
    .execute();
}

describe("createProvider", () => {
  it("writes both tables, disabled, with the secret sealed in the raw row (V11.3.2)", async () => {
    const { ctx, database } = await setup();
    expect(await createProvider(ctx, OIDC)).toEqual({ ok: true, providerId: "entra" });
    const raw = await sql<{ oidcConfig: string }>`select "oidcConfig" from "ssoProvider"`.execute(
      database,
    );
    const stored = raw.rows[0]?.oidcConfig ?? "";
    expect(stored).not.toContain(SECRET);
    const config: unknown = JSON.parse(stored);
    expect(isEnvelope(Reflect.get(Object(config), "clientSecret"))).toBe(true);
    expect(config).toMatchObject({
      issuer: ISSUER,
      pkce: true,
      scopes: ["openid", "email", "profile"],
      authorizationEndpoint: `${ISSUER}/authorize`,
    });
    expect(config).not.toHaveProperty("userInfoEndpoint");
    const settings = await providerSettings(database, "entra");
    expect(settings).toMatchObject({
      enabled: false,
      protocol: "oidc",
      roleClaim: "roles",
      emailAuthoritative: true,
      endSessionEndpoint: `${ISSUER}/logout`,
    });
    expect(Object.fromEntries(settings?.roleMap ?? [])).toEqual({
      "edulims-teacher": "teacher",
      "edulims-admin": "admin",
    });
    expect(await auditRows(database)).toEqual([
      {
        action: "idp_created",
        actor_type: "system",
        target_type: "identity_provider",
        target_id: "entra",
        metadata: { provider_id: "entra", protocol: "oidc" },
      },
    ]);
  });

  it("stores a SAML provider with signed assertions and the persistent NameID forced", async () => {
    const { ctx, database } = await setup();
    expect(await createProvider(ctx, SAML)).toEqual({ ok: true, providerId: "campus-saml" });
    const row = await database
      .selectFrom("ssoProvider")
      .select(["issuer", "samlConfig"])
      .executeTakeFirstOrThrow();
    expect(row.issuer).toBe(
      "https://edulims.example/api/auth/sso/saml2/sp/metadata?providerId=campus-saml",
    );
    expect(JSON.parse(row.samlConfig ?? "{}")).toMatchObject({
      wantAssertionsSigned: true,
      authnRequestsSigned: false,
      identifierFormat: "urn:oasis:names:tc:SAML:2.0:nameid-format:persistent",
      entryPoint: "https://idp.example.test/saml/sso",
    });
  });

  it("refuses an existing provider id and a domain of another provider", async () => {
    const { ctx } = await setup();
    await createProvider(ctx, OIDC);
    expect(await createProvider(ctx, OIDC)).toEqual({ ok: false, error: "exists" });
    expect(
      await createProvider(ctx, {
        ...SAML,
        settings: { ...SAML.settings, domains: ["example.edu"] },
      }),
    ).toEqual({ ok: false, error: "domain_taken" });
  });

  it("refuses without a data key, and writes nothing", async () => {
    const { ctx, database } = await setup();
    const result = await createProvider(
      { ...ctx, keyring: { current: null, previous: null } },
      OIDC,
    );
    expect(result).toEqual({ ok: false, error: "missing_key" });
    expect(await database.selectFrom("ssoProvider").select("id").execute()).toEqual([]);
    expect(await auditRows(database)).toEqual([]);
  });

  it("refuses an issuer on a private address (SSRF)", async () => {
    const { ctx } = await setup();
    const policy = { ...ctx.policy, resolve: async () => ["10.0.0.8"] };
    expect(await createProvider({ ...ctx, policy }, OIDC)).toEqual({
      ok: false,
      error: "issuer_private",
    });
  });
});

describe("updateProvider", () => {
  it("keeps the stored secret when none is given, and records the changed field names", async () => {
    const { ctx, database } = await setup();
    await createProvider(ctx, OIDC);
    const result = await updateProvider(ctx, {
      ...OIDC,
      settings: { ...SETTINGS, labelEn: "Entra", defaultRole: "student" },
      oidc: { ...OIDC.oidc, clientSecret: "" },
    });
    expect(result).toEqual({ ok: true, providerId: "entra" });
    const detail = await providerDetail(database, {
      keyring: ctx.keyring,
      baseURL: ctx.baseURL,
      providerId: "entra",
      locale: "en",
    });
    expect(detail?.oidc).toEqual({
      issuer: ISSUER,
      clientId: "client-1",
      secretSet: true,
      attestPkce: false,
    });
    expect(JSON.stringify(detail)).not.toContain(SECRET);
    const rows = await auditRows(database);
    expect(rows.at(-1)).toMatchObject({
      action: "idp_updated",
      metadata: { provider_id: "entra", protocol: "oidc", fields: ["label", "default_role"] },
    });
  });

  it("records no domain change when only the order differs", async () => {
    const { ctx, database } = await setup();
    // A collation that ignores punctuation sorts these two the other way round from code points.
    const domains = ["ab.example.edu", "a-c.example.edu"];
    await createProvider(ctx, { ...OIDC, settings: { ...SETTINGS, domains } });
    await updateProvider(ctx, {
      ...OIDC,
      settings: { ...SETTINGS, labelEn: "Entra", domains: [...domains].reverse() },
      oidc: { ...OIDC.oidc, clientSecret: "" },
    });
    expect((await auditRows(database)).at(-1)).toMatchObject({
      action: "idp_updated",
      metadata: { fields: ["label"] },
    });
  });

  it("records a secret rotation without its value", async () => {
    const { ctx, database } = await setup();
    await createProvider(ctx, OIDC);
    await updateProvider(ctx, { ...OIDC, oidc: { ...OIDC.oidc, clientSecret: "rotated-value" } });
    const rows = await auditRows(database);
    expect(rows.map((row) => row.action)).toEqual([
      "idp_created",
      "idp_updated",
      "idp_secret_rotated",
    ]);
    expect(JSON.stringify(rows)).not.toContain("rotated-value");
  });

  it("refreshes SAML metadata only when new metadata is given", async () => {
    const { ctx, database } = await setup();
    await createProvider(ctx, SAML);
    await updateProvider(ctx, {
      ...SAML,
      saml: { metadataXml: "", metadataUrl: "", spPrivateKey: "" },
    });
    await updateProvider(ctx, SAML);
    expect((await auditRows(database)).map((row) => row.action)).toEqual([
      "idp_created",
      "idp_updated",
      "idp_updated",
      "idp_metadata_refreshed",
    ]);
  });

  it("refuses an unknown provider and a protocol change", async () => {
    const { ctx } = await setup();
    await createProvider(ctx, OIDC);
    expect(await updateProvider(ctx, { ...SAML, providerId: "entra" })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await updateProvider(ctx, { ...OIDC, providerId: "nobody" })).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});

describe("enable, disable and delete", () => {
  it("enables and disables with an activity-log row each", async () => {
    const { ctx, database } = await setup();
    await createProvider(ctx, OIDC);
    expect(await setProviderEnabled(ctx, { providerId: "entra", enabled: true })).toMatchObject({
      ok: true,
    });
    expect((await enabledProviders(database, "nl")).map((p) => p.label)).toEqual([
      "Entra ID (instelling)",
    ]);
    await setProviderEnabled(ctx, { providerId: "entra", enabled: false });
    expect(await enabledProviders(database, "en")).toEqual([]);
    expect((await auditRows(database)).map((row) => row.action)).toEqual([
      "idp_created",
      "idp_enabled",
      "idp_disabled",
    ]);
  });

  it("refuses to disable or delete the last enabled provider in production", async () => {
    const { ctx } = await setup(true);
    await createProvider(ctx, OIDC);
    await setProviderEnabled(ctx, { providerId: "entra", enabled: true });
    expect(await setProviderEnabled(ctx, { providerId: "entra", enabled: false })).toEqual({
      ok: false,
      error: "last_enabled",
    });
    expect(await deleteProvider(ctx, { providerId: "entra" })).toEqual({
      ok: false,
      error: "last_enabled",
    });
    // The host CLI is the way out.
    expect(
      await setProviderEnabled(ctx, { providerId: "entra", enabled: false, allowLast: true }),
    ).toMatchObject({ ok: true });
  });

  it("refuses to delete a provider someone signed in with", async () => {
    const { ctx, database } = await setup();
    await createProvider(ctx, OIDC);
    const now = new Date();
    await database
      .insertInto("user")
      .values({ id: "u1", name: "U", email: "u@example.test", emailVerified: true })
      .execute();
    await database
      .insertInto("account")
      .values({
        id: "a1",
        accountId: "sub-1",
        providerId: "entra",
        userId: "u1",
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    expect(await deleteProvider(ctx, { providerId: "entra" })).toEqual({
      ok: false,
      error: "has_accounts",
    });
    expect((await listProviders(database, "en")).map((row) => row.accounts)).toEqual([1]);
  });

  it("deletes an unused provider with its settings and domains", async () => {
    const { ctx, database } = await setup();
    await createProvider(ctx, OIDC);
    expect(await deleteProvider(ctx, { providerId: "entra" })).toMatchObject({ ok: true });
    expect(await database.selectFrom("identity_provider").select("id").execute()).toEqual([]);
    expect(
      await database.selectFrom("identity_provider_domain").select("domain").execute(),
    ).toEqual([]);
    expect((await auditRows(database)).at(-1)?.action).toBe("idp_deleted");
  });
});

describe("runtime reads", () => {
  it("routes an institution email of an enabled provider only, case-insensitively", async () => {
    const { ctx, database } = await setup();
    await createProvider(ctx, OIDC);
    expect(await providerForEmail(database, "someone@EXAMPLE.edu")).toBeNull();
    await setProviderEnabled(ctx, { providerId: "entra", enabled: true });
    expect(await hasDomainRouting(database)).toBe(true);
    expect(await providerForEmail(database, "someone@EXAMPLE.edu")).toBe("entra");
    expect(await providerForEmail(database, "someone@other.edu")).toBeNull();
    expect(await providerForEmail(database, "no-at-sign")).toBeNull();
  });

  it("labels every provider per locale for the screens that name them", async () => {
    const { ctx, database } = await setup();
    await createProvider(ctx, OIDC);
    expect(await providerLabels(database, "nl")).toEqual({ entra: "Entra ID (instelling)" });
    expect(await providerSettings(database, "Not A Slug")).toBeNull();
  });
});

/** Returns the database adapter better-auth runs with, sealing under `key`. */
async function adapterOf(database: Kysely<DB>, key: string) {
  const env = parseEnv({ ...VALID_ENV, EDULIMS_DATA_KEY: key });
  return (await (await createTestAuth(env, { db: database, type: "postgres" })).$context).adapter;
}

describe("the encrypting adapter (ADR 0015)", () => {
  it("opens ssoProvider rows for the sso plugin and leaves other models alone", async () => {
    const { ctx, database } = await setup();
    await createProvider(ctx, OIDC);
    await database
      .insertInto("user")
      .values({ id: "u1", name: "U", email: "u@example.test", emailVerified: true })
      .execute();
    const adapter = await adapterOf(database, KEY);
    const row = await adapter.findOne<{ oidcConfig: string }>({
      model: "ssoProvider",
      where: [{ field: "providerId", value: "entra" }],
    });
    expect(JSON.parse(row?.oidcConfig ?? "{}")).toMatchObject({ clientSecret: SECRET });
    const user = await adapter.findOne<{ email: string }>({
      model: "user",
      where: [{ field: "id", value: "u1" }],
    });
    expect(user?.email).toBe("u@example.test");
  });

  it("seals a config written through the adapter, also inside a transaction", async () => {
    const { ctx, database } = await setup();
    await createProvider(ctx, OIDC);
    const adapter = await adapterOf(database, KEY);
    await adapter.transaction(async (trx) => {
      await trx.update({
        model: "ssoProvider",
        where: [{ field: "providerId", value: "entra" }],
        update: { oidcConfig: JSON.stringify({ clientId: "c", clientSecret: "plain-again" }) },
      });
    });
    const raw = await database.selectFrom("ssoProvider").select("oidcConfig").executeTakeFirst();
    expect(raw?.oidcConfig).not.toContain("plain-again");
  });

  it("fails closed with crypt_decrypt_fail when the key does not open a row", async () => {
    const { ctx, database } = await setup();
    await createProvider(ctx, OIDC);
    const lines: string[] = [];
    const restore = setSecurityLogWriter((line) => lines.push(line));
    const adapter = await adapterOf(database, Buffer.alloc(32, 9).toString("base64"));
    try {
      await expect(
        adapter.findMany({
          model: "ssoProvider",
          where: [{ field: "providerId", value: "entra" }],
        }),
      ).rejects.toThrow(/unknown_key/);
    } finally {
      restore();
    }
    const decryptFailures = lines
      .map((line): unknown => JSON.parse(line))
      .filter((line) => field(line, "event") === "crypt_decrypt_fail");
    expect(decryptFailures).toEqual([
      expect.objectContaining({
        level: "error",
        kind: "unknown_key",
        target_type: "identity_provider",
        target_id: "entra",
      }),
    ]);
  });
});
