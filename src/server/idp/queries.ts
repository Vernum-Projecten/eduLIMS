// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The reads of Admin → System → Identity providers (#46). A provider's secrets never leave the
// server: the screen sees only whether one is stored.
import "@tanstack/react-start/server-only";
import { type Kysely, sql } from "kysely";
import {
  PROVIDER_ICONS,
  type ProviderIcon,
  type ProviderProtocol,
} from "../../lib/identity-providers.ts";
import { isRole, type Role } from "../../lib/roles.ts";
import type { DB } from "../db/schema.gen.ts";
import { type ConfigColumn, type Keyring, openConfig } from "./crypto.ts";
import { type ProviderUrls, providerUrls } from "./provider-config.ts";
import { roleMapOf } from "./registry.ts";
import type { ProviderSettings } from "./schemas.ts";

/** One row of the providers table. */
export interface ProviderListRow {
  providerId: string;
  label: string;
  protocol: ProviderProtocol;
  enabled: boolean;
  domains: string[];
  /** How many accounts sign in through it (`account.providerId`). */
  accounts: number;
}

function protocolOf(value: string): ProviderProtocol {
  return value === "saml" ? "saml" : "oidc";
}

function iconOf(value: string): ProviderIcon {
  return PROVIDER_ICONS.find((icon) => icon === value) ?? "key-round";
}

/** Returns every provider in sign-in page order, labelled for `locale`. */
export async function listProviders(
  db: Kysely<DB>,
  locale: "en" | "nl",
): Promise<ProviderListRow[]> {
  const rows = await db
    .selectFrom("identity_provider as p")
    .select([
      "p.provider_id",
      "p.label_en",
      "p.label_nl",
      "p.protocol",
      "p.enabled",
      (eb) =>
        eb
          .selectFrom("identity_provider_domain as d")
          .select(sql<string[]>`coalesce(array_agg(d.domain order by d.domain), '{}')`.as("x"))
          .whereRef("d.provider_id", "=", "p.provider_id")
          .as("domains"),
      (eb) =>
        eb
          .selectFrom("account as a")
          .select(sql<string>`count(*)`.as("n"))
          .whereRef("a.providerId", "=", "p.provider_id")
          .as("accounts"),
    ])
    .orderBy("p.sort_order")
    .orderBy("p.provider_id")
    .execute();
  return rows.map((row) => ({
    providerId: row.provider_id,
    label: locale === "nl" ? row.label_nl : row.label_en,
    protocol: protocolOf(row.protocol),
    enabled: row.enabled,
    domains: row.domains ?? [],
    accounts: Number(row.accounts ?? 0),
  }));
}

/** One provider as the edit page shows it: its settings and config, never a secret. */
export interface ProviderDetail {
  providerId: string;
  protocol: ProviderProtocol;
  enabled: boolean;
  label: string;
  settings: ProviderSettings;
  oidc: { issuer: string; clientId: string; secretSet: boolean } | null;
  saml: { metadataUrl: string; entityId: string; signingKeySet: boolean } | null;
  urls: ProviderUrls;
  /** Whether sign-out also ends the IdP session (OIDC `end_session_endpoint`). */
  endSession: boolean;
  accounts: number;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function openedConfig(
  keyring: Keyring,
  providerId: string,
  column: ConfigColumn,
  stored: string | null,
): Record<string, unknown> | null {
  if (!stored) return null;
  const value: unknown = JSON.parse(openConfig(keyring, providerId, column, stored));
  return typeof value === "object" && value !== null
    ? Object.fromEntries(Object.entries(value))
    : null;
}

/** Returns one provider for the edit page, or `null` when it does not exist. */
export async function providerDetail(
  db: Kysely<DB>,
  input: { keyring: Keyring; baseURL: string; providerId: string; locale: "en" | "nl" },
): Promise<ProviderDetail | null> {
  const row = await db
    .selectFrom("identity_provider as p")
    .innerJoin("ssoProvider as s", "s.providerId", "p.provider_id")
    .select([
      "p.provider_id",
      "p.protocol",
      "p.enabled",
      "p.label_en",
      "p.label_nl",
      "p.icon",
      "p.sort_order",
      "p.role_claim",
      "p.role_map",
      "p.default_role",
      "p.email_authoritative",
      "p.end_session_endpoint",
      "p.metadata_url",
      "s.oidcConfig",
      "s.samlConfig",
      (eb) =>
        eb
          .selectFrom("identity_provider_domain as d")
          .select(sql<string[]>`coalesce(array_agg(d.domain order by d.domain), '{}')`.as("x"))
          .whereRef("d.provider_id", "=", "p.provider_id")
          .as("domains"),
      (eb) =>
        eb
          .selectFrom("account as a")
          .select(sql<string>`count(*)`.as("n"))
          .whereRef("a.providerId", "=", "p.provider_id")
          .as("accounts"),
    ])
    .where("p.provider_id", "=", input.providerId)
    .executeTakeFirst();
  if (!row) return null;
  const oidc = openedConfig(input.keyring, row.provider_id, "oidcConfig", row.oidcConfig);
  const saml = openedConfig(input.keyring, row.provider_id, "samlConfig", row.samlConfig);
  const defaultRole: Role | null = isRole(row.default_role) ? row.default_role : null;
  const urls = providerUrls(input.baseURL, row.provider_id);
  return {
    providerId: row.provider_id,
    protocol: protocolOf(row.protocol),
    enabled: row.enabled,
    label: input.locale === "nl" ? row.label_nl : row.label_en,
    settings: {
      labelEn: row.label_en,
      labelNl: row.label_nl,
      icon: iconOf(row.icon),
      sortOrder: row.sort_order,
      roleClaim: row.role_claim,
      roleMap: [...roleMapOf(row.role_map)].map(([value, role]) => ({ value, role })),
      defaultRole,
      emailAuthoritative: row.email_authoritative,
      domains: row.domains ?? [],
    },
    oidc: oidc
      ? {
          issuer: text(oidc["issuer"]),
          clientId: text(oidc["clientId"]),
          secretSet: text(oidc["clientSecret"]) !== "",
        }
      : null,
    saml: saml
      ? {
          metadataUrl: row.metadata_url ?? "",
          entityId: urls.spEntityId,
          signingKeySet: text(Reflect.get(Object(saml["spMetadata"]), "privateKey")) !== "",
        }
      : null,
    urls,
    endSession: row.end_session_endpoint !== null,
    accounts: Number(row.accounts ?? 0),
  };
}
