// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Runtime reads of the identity providers (#46, ADR 0015): the role settings the sign-in gate
// needs, the login buttons and the domain routing. Settings are cached for
// a short time per process and dropped on every change the service makes.
// Relative imports: `pnpm db:seed` loads auth.ts in plain Node.
import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import {
  type IdentityProviderOption,
  PROVIDER_ICONS,
  type ProviderIcon,
  type ProviderId,
  type ProviderProtocol,
  parseProviderId,
} from "../../lib/identity-providers.ts";
import { isRole, type Role } from "../../lib/roles.ts";
import type { DB } from "../db/schema.gen.ts";
import type { RoleMap } from "../idp-roles.ts";

/** The settings of one provider that sign-in and sign-out read. */
export interface ProviderSettingsView {
  providerId: ProviderId;
  protocol: ProviderProtocol;
  enabled: boolean;
  roleClaim: string;
  roleMap: RoleMap;
  defaultRole: Role | undefined;
  emailAuthoritative: boolean;
  endSessionEndpoint: string | null;
}

/** How long a cached read stays valid; a change through the service drops it at once. */
const TTL_MS = 30_000;

let cache = new Map<string, { at: number; value: unknown }>();

/** Drops every cached provider read (called by every write of the admin service). */
export function invalidateProviderCache(): void {
  cache = new Map();
}

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Returns a stored role map (`{ "idp-value": "role" }`) as a {@link RoleMap}, dropping bad entries. */
export function roleMapOf(value: unknown): RoleMap {
  const map = new Map<string, Role>();
  if (typeof value !== "object" || value === null || Array.isArray(value)) return map;
  for (const [idpValue, role] of Object.entries(value)) {
    if (isRole(role)) map.set(idpValue, role);
  }
  return map;
}

function protocolOf(value: string): ProviderProtocol {
  return value === "saml" ? "saml" : "oidc";
}

function iconOf(value: string): ProviderIcon {
  return PROVIDER_ICONS.find((icon) => icon === value) ?? "key-round";
}

/**
 * Returns the settings of one provider, or `null` when eduLIMS does not know it. `fresh` skips
 * the cache: the sign-in gate must see a provider another process disabled at once.
 */
export async function providerSettings(
  db: Kysely<DB>,
  providerId: string,
  options: { fresh?: boolean } = {},
): Promise<ProviderSettingsView | null> {
  const id = parseProviderId(providerId);
  if (!id) return null;
  const load = async () => {
    const row = await db
      .selectFrom("identity_provider")
      .select([
        "protocol",
        "enabled",
        "role_claim",
        "role_map",
        "default_role",
        "email_authoritative",
        "end_session_endpoint",
      ])
      .where("provider_id", "=", id)
      .executeTakeFirst();
    if (!row) return null;
    return {
      providerId: id,
      protocol: protocolOf(row.protocol),
      enabled: row.enabled,
      roleClaim: row.role_claim,
      roleMap: roleMapOf(row.role_map),
      defaultRole: isRole(row.default_role) ? row.default_role : undefined,
      emailAuthoritative: row.email_authoritative,
      endSessionEndpoint: row.end_session_endpoint,
    };
  };
  return options.fresh ? load() : cached(`settings:${id}`, load);
}

/**
 * Returns whether a provider exists and is enabled, read from the database every time (never
 * the cache), for the session read (ASVS V7.4.2).
 */
export async function providerEnabled(db: Kysely<DB>, providerId: string): Promise<boolean> {
  const id = parseProviderId(providerId);
  if (!id) return false;
  const row = await db
    .selectFrom("identity_provider")
    .select("enabled")
    .where("provider_id", "=", id)
    .executeTakeFirst();
  return row?.enabled === true;
}

/** Returns the enabled providers as login buttons, in their order, labelled for `locale`. */
export async function enabledProviders(
  db: Kysely<DB>,
  locale: "en" | "nl",
): Promise<IdentityProviderOption[]> {
  const rows = await cached("enabled", () =>
    db
      .selectFrom("identity_provider")
      .select(["provider_id", "protocol", "label_en", "label_nl", "icon"])
      .where("enabled", "=", true)
      .orderBy("sort_order")
      .orderBy("provider_id")
      .execute(),
  );
  return rows.flatMap((row) => {
    const id = parseProviderId(row.provider_id);
    if (!id) return [];
    return [
      {
        id,
        label: locale === "nl" ? row.label_nl : row.label_en,
        icon: iconOf(row.icon),
        protocol: protocolOf(row.protocol),
      },
    ];
  });
}

/**
 * Returns every provider id with its label for `locale`, enabled or not, for the screens that
 * name a role source or a sign-in method.
 */
export async function providerLabels(
  db: Kysely<DB>,
  locale: "en" | "nl",
): Promise<Record<string, string>> {
  const rows = await db
    .selectFrom("identity_provider")
    .select(["provider_id", "label_en", "label_nl"])
    .orderBy("sort_order")
    .orderBy("provider_id")
    .execute();
  return Object.fromEntries(
    rows.map((row) => [row.provider_id, locale === "nl" ? row.label_nl : row.label_en]),
  );
}

/** Returns whether any enabled provider has email domains (the "institution email" field). */
export async function hasDomainRouting(db: Kysely<DB>): Promise<boolean> {
  return cached("domains", async () => {
    const row = await db
      .selectFrom("identity_provider_domain as d")
      .innerJoin("identity_provider as p", "p.provider_id", "d.provider_id")
      .select("d.domain")
      .where("p.enabled", "=", true)
      .executeTakeFirst();
    return row !== undefined;
  });
}

/** Returns the enabled provider an email domain routes to, or `null` (never which one exists). */
export async function providerForEmail(db: Kysely<DB>, email: string): Promise<ProviderId | null> {
  const domain = email.split("@").at(-1)?.trim().toLowerCase();
  if (!domain) return null;
  const row = await db
    .selectFrom("identity_provider_domain as d")
    .innerJoin("identity_provider as p", "p.provider_id", "d.provider_id")
    .select("p.provider_id")
    .where("d.domain", "=", domain)
    .where("p.enabled", "=", true)
    .executeTakeFirst();
  return row ? parseProviderId(row.provider_id) : null;
}
