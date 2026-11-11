// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The identity-provider admin service (#46, ADR 0015): the only writer of `ssoProvider` and
// `identity_provider`. The Admin screen and the host CLI (`pnpm idp:add`) both call it, so every
// change is validated, sealed and audited the same way, in one transaction with its log row.
// The sso plugin's own management endpoints are disabled (src/server/auth.ts).
// Relative imports: the host CLI loads this in plain Node.
import "@tanstack/react-start/server-only";
import { randomUUID } from "node:crypto";
import type { Kysely, Transaction } from "kysely";
import type { DB } from "../db/schema.gen.ts";
import { openConfig, sealConfig } from "./crypto.ts";
import { buildOidcConfig, buildSamlConfig, pluginDomain, providerUrls } from "./provider-config.ts";
import { invalidateProviderCache } from "./registry.ts";
import type { CreateProviderInput, ProviderSettings, UpdateProviderInput } from "./schemas.ts";
import {
  actorId,
  audit,
  guarded,
  type IdpResult,
  type IdpServiceContext,
  refused,
} from "./service-core.ts";
import {
  discoverOidc,
  fetchSamlMetadata,
  type OriginPolicy,
  parseSamlMetadata,
} from "./validate.ts";

export { deleteProvider, setProviderEnabled } from "./lifecycle.ts";
export type { IdpResult, IdpServiceContext, IdpServiceError } from "./service-core.ts";

function settingsRow(settings: ProviderSettings) {
  return {
    label_en: settings.labelEn,
    label_nl: settings.labelNl,
    icon: settings.icon,
    sort_order: settings.sortOrder,
    role_claim: settings.roleClaim,
    role_map: JSON.stringify(
      Object.fromEntries(settings.roleMap.map((entry) => [entry.value, entry.role])),
    ),
    default_role: settings.defaultRole,
    email_authoritative: settings.emailAuthoritative,
  };
}

async function domainsTaken(
  db: Kysely<DB>,
  domains: readonly string[],
  providerId: string,
): Promise<boolean> {
  if (domains.length === 0) return false;
  const row = await db
    .selectFrom("identity_provider_domain")
    .select("domain")
    .where("domain", "in", [...domains])
    .where("provider_id", "<>", providerId)
    .executeTakeFirst();
  return row !== undefined;
}

async function replaceDomains(
  trx: Transaction<DB>,
  providerId: string,
  domains: readonly string[],
) {
  await trx.deleteFrom("identity_provider_domain").where("provider_id", "=", providerId).execute();
  if (domains.length === 0) return;
  await trx
    .insertInto("identity_provider_domain")
    .values(domains.map((domain) => ({ domain, provider_id: providerId })))
    .execute();
}

/** Reads the IdP metadata of a SAML input: the pasted XML, else the URL fetched once. */
async function samlMetadataOf(
  saml: { metadataXml: string; metadataUrl: string },
  policy: OriginPolicy,
): Promise<string | null> {
  if (saml.metadataXml.trim() !== "") return saml.metadataXml.trim();
  if (saml.metadataUrl !== "") return fetchSamlMetadata(saml.metadataUrl, policy);
  return null;
}

/** Creates a provider, disabled, from the Admin screen or `pnpm idp:add` (`idp_created`). */
export async function createProvider(
  ctx: IdpServiceContext,
  input: CreateProviderInput,
): Promise<IdpResult> {
  return guarded(async () => {
    const { providerId, settings } = input;
    const existing = await ctx.db
      .selectFrom("ssoProvider")
      .select("providerId")
      .where("providerId", "=", providerId)
      .executeTakeFirst();
    if (existing) return refused("exists");
    if (await domainsTaken(ctx.db, settings.domains, providerId)) return refused("domain_taken");
    let issuer: string;
    let oidcConfig: string | null = null;
    let samlConfig: string | null = null;
    let endSession: string | null = null;
    let metadataUrl: string | null = null;
    let attestPkce = false;
    if (input.protocol === "oidc") {
      attestPkce = input.oidc.attestPkce;
      const discovered = await discoverOidc(input.oidc.issuer, ctx.policy, { attestPkce });
      issuer = input.oidc.issuer;
      endSession = discovered.endSessionEndpoint;
      const config = buildOidcConfig({ ...input.oidc, discovered });
      oidcConfig = sealConfig(ctx.keyring, providerId, "oidcConfig", JSON.stringify(config));
    } else {
      const xml = await samlMetadataOf(input.saml, ctx.policy);
      if (xml === null) return refused("metadata_invalid");
      const parsed = parseSamlMetadata(xml);
      const { spEntityId } = providerUrls(ctx.baseURL, providerId);
      issuer = spEntityId;
      metadataUrl = input.saml.metadataUrl === "" ? null : input.saml.metadataUrl;
      const key = input.saml.spPrivateKey === "" ? null : input.saml.spPrivateKey;
      const config = buildSamlConfig({ spEntityId, metadataXml: xml, parsed, spPrivateKey: key });
      samlConfig = sealConfig(ctx.keyring, providerId, "samlConfig", JSON.stringify(config));
    }
    await ctx.db.transaction().execute(async (trx) => {
      await trx
        .insertInto("ssoProvider")
        .values({
          id: randomUUID(),
          issuer,
          oidcConfig,
          samlConfig,
          userId: actorId(ctx),
          providerId,
          domain: pluginDomain(providerId),
        })
        .execute();
      await trx
        .insertInto("identity_provider")
        .values({
          provider_id: providerId,
          protocol: input.protocol,
          enabled: false,
          attest_pkce: attestPkce,
          end_session_endpoint: endSession,
          metadata_url: metadataUrl,
          created_by: actorId(ctx),
          updated_by: actorId(ctx),
          ...settingsRow(settings),
        })
        .execute();
      await replaceDomains(trx, providerId, settings.domains);
      await audit(
        trx,
        ctx,
        "idp_created",
        providerId,
        input.protocol,
        attestPkce ? { attest_pkce: true } : {},
      );
    });
    invalidateProviderCache();
    return { ok: true, providerId };
  });
}

/** The stored state of one provider that an edit compares against. */
async function storedProvider(db: Kysely<DB>, providerId: string) {
  return db
    .selectFrom("identity_provider as p")
    .innerJoin("ssoProvider as s", "s.providerId", "p.provider_id")
    .select([
      "p.protocol",
      "p.label_en",
      "p.label_nl",
      "p.icon",
      "p.sort_order",
      "p.role_claim",
      "p.role_map",
      "p.default_role",
      "p.email_authoritative",
      "p.attest_pkce",
      "p.metadata_url",
      "s.oidcConfig",
      "s.samlConfig",
    ])
    .where("p.provider_id", "=", providerId)
    .executeTakeFirst();
}

/** Returns a role map in one order, since `jsonb` stores its keys sorted its own way. */
function canonical(roleMap: unknown): string {
  const entries = typeof roleMap === "object" && roleMap !== null ? Object.entries(roleMap) : [];
  return JSON.stringify(entries.sort(([a], [b]) => a.localeCompare(b)));
}

function changedSettings(
  before: NonNullable<Awaited<ReturnType<typeof storedProvider>>>,
  after: ReturnType<typeof settingsRow>,
  domainsChanged: boolean,
): string[] {
  const changed: string[] = [];
  if (before.label_en !== after.label_en || before.label_nl !== after.label_nl)
    changed.push("label");
  if (before.icon !== after.icon) changed.push("icon");
  if (before.sort_order !== after.sort_order) changed.push("sort_order");
  if (before.role_claim !== after.role_claim) changed.push("role_claim");
  if (canonical(before.role_map) !== canonical(JSON.parse(after.role_map))) {
    changed.push("role_map");
  }
  if (before.default_role !== after.default_role) changed.push("default_role");
  if (before.email_authoritative !== after.email_authoritative) changed.push("email_authoritative");
  if (domainsChanged) changed.push("domains");
  return changed;
}

function parseObject(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}

/**
 * Edits a provider (`idp_updated`, plus `idp_secret_rotated` or `idp_metadata_refreshed`). The
 * id and the protocol never change. OIDC discovery runs again on every save, so a changed
 * endpoint at the IdP is picked up; an empty secret keeps the stored one, except when the
 * issuer changes at all (`client_secret_required`): the stored secret belongs to the old IdP
 * and must never be sent to another, and Entra ID tenants and Keycloak realms share an origin.
 */
export async function updateProvider(
  ctx: IdpServiceContext,
  input: UpdateProviderInput,
): Promise<IdpResult> {
  return guarded(async () => {
    const { providerId, settings } = input;
    const before = await storedProvider(ctx.db, providerId);
    if (!before || before.protocol !== input.protocol) return refused("not_found");
    if (await domainsTaken(ctx.db, settings.domains, providerId)) return refused("domain_taken");
    const oldDomains = await ctx.db
      .selectFrom("identity_provider_domain")
      .select("domain")
      .where("provider_id", "=", providerId)
      .orderBy("domain")
      .execute();
    // Both sides sorted the same way: PostgreSQL's collation can order domains differently.
    const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    const domainsChanged =
      JSON.stringify(oldDomains.map((row) => row.domain).sort(byCodePoint)) !==
      JSON.stringify([...settings.domains].sort(byCodePoint));
    const row = settingsRow(settings);
    const fields = changedSettings(before, row, domainsChanged);
    const extra: ("idp_secret_rotated" | "idp_metadata_refreshed")[] = [];
    const update: {
      issuer?: string;
      oidcConfig?: string;
      samlConfig?: string;
      attestPkce?: boolean;
    } = {};
    let endSession: string | null | undefined;
    let metadataUrl: string | null | undefined;
    if (input.protocol === "oidc" && before.oidcConfig) {
      const current = parseObject(
        openConfig(ctx.keyring, providerId, "oidcConfig", before.oidcConfig),
      );
      const rotated = input.oidc.clientSecret.trim() !== "";
      // NOTE: #92 L2; a client secret goes only to the issuer that issued it, path included.
      if (!rotated && current["issuer"] !== input.oidc.issuer) {
        return refused("client_secret_required");
      }
      const attestPkce = input.oidc.attestPkce;
      const discovered = await discoverOidc(input.oidc.issuer, ctx.policy, { attestPkce });
      if (attestPkce !== before.attest_pkce) fields.push("attest_pkce");
      update.attestPkce = attestPkce;
      const secret = rotated ? input.oidc.clientSecret : String(current["clientSecret"] ?? "");
      if (current["issuer"] !== input.oidc.issuer) fields.push("issuer");
      if (current["clientId"] !== input.oidc.clientId) fields.push("client_id");
      if (rotated) extra.push("idp_secret_rotated");
      const config = buildOidcConfig({ ...input.oidc, clientSecret: secret, discovered });
      update.issuer = input.oidc.issuer;
      update.oidcConfig = sealConfig(ctx.keyring, providerId, "oidcConfig", JSON.stringify(config));
      endSession = discovered.endSessionEndpoint;
    } else if (input.protocol === "saml" && before.samlConfig) {
      const current = parseObject(
        openConfig(ctx.keyring, providerId, "samlConfig", before.samlConfig),
      );
      const fresh = await samlMetadataOf(input.saml, ctx.policy);
      const storedXml = Reflect.get(Object(current["idpMetadata"]), "metadata");
      const xml = fresh ?? (typeof storedXml === "string" ? storedXml : null);
      if (xml === null) return refused("metadata_invalid");
      const parsed = parseSamlMetadata(xml);
      if (fresh !== null) extra.push("idp_metadata_refreshed");
      const storedKey = Reflect.get(Object(current["spMetadata"]), "privateKey");
      const key =
        input.saml.spPrivateKey !== ""
          ? input.saml.spPrivateKey
          : typeof storedKey === "string"
            ? storedKey
            : null;
      if (input.saml.spPrivateKey !== "") extra.push("idp_secret_rotated");
      const { spEntityId } = providerUrls(ctx.baseURL, providerId);
      const config = buildSamlConfig({ spEntityId, metadataXml: xml, parsed, spPrivateKey: key });
      update.samlConfig = sealConfig(ctx.keyring, providerId, "samlConfig", JSON.stringify(config));
      metadataUrl = input.saml.metadataUrl === "" ? before.metadata_url : input.saml.metadataUrl;
    } else {
      return refused("not_found");
    }
    const { attestPkce, ...plugin } = update;
    await ctx.db.transaction().execute(async (trx) => {
      await trx
        .updateTable("ssoProvider")
        .set(plugin)
        .where("providerId", "=", providerId)
        .execute();
      await trx
        .updateTable("identity_provider")
        .set({
          ...row,
          ...(attestPkce !== undefined ? { attest_pkce: attestPkce } : {}),
          ...(endSession !== undefined ? { end_session_endpoint: endSession } : {}),
          ...(metadataUrl !== undefined ? { metadata_url: metadataUrl } : {}),
          updated_by: actorId(ctx),
          updated_at: new Date(),
        })
        .where("provider_id", "=", providerId)
        .execute();
      await replaceDomains(trx, providerId, settings.domains);
      await audit(trx, ctx, "idp_updated", providerId, input.protocol, {
        fields,
        // The attestation's new value, so the log shows whether it was given or withdrawn.
        ...(attestPkce !== undefined && fields.includes("attest_pkce")
          ? { attest_pkce: attestPkce }
          : {}),
      });
      for (const action of extra) await audit(trx, ctx, action, providerId, input.protocol);
    });
    invalidateProviderCache();
    return { ok: true, providerId };
  });
}
