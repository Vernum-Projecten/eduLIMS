// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The read of Admin → System (#36): the enabled identity providers with the URLs registered at
// them and their role settings, and the build. It reads `identity_provider` only, never the
// sealed `ssoProvider` configuration, so no client secret or key can reach the page.
import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import type { ProviderProtocol } from "../../lib/identity-providers.ts";
import { isRole, type Role } from "../../lib/roles.ts";
import type { SessionUser } from "../authz.ts";
import type { DB } from "../db/schema.gen.ts";
import { providerUrls } from "../idp/provider-config.ts";
import { roleMapOf } from "../idp/registry.ts";
import { assertAdmin } from "../users/actions.ts";
import { type BuildInfo, readBuildInfo } from "./build-info.ts";

/** One enabled identity provider as the system page shows it. */
export interface SystemProvider {
  providerId: string;
  label: string;
  protocol: ProviderProtocol;
  /** OIDC: the redirect URI; SAML: the assertion consumer service URL. */
  callbackUrl: string;
  roleClaim: string;
  /** The role map, sorted by the provider's value. */
  roleMap: { value: string; role: Role }[];
  defaultRole: Role | null;
}

/** Everything the system page shows. */
export interface SystemConfiguration {
  providers: SystemProvider[];
  build: BuildInfo;
}

/** What the read runs with: the database, the caller, the app URL, the locale and the build env. */
export interface SystemReadContext {
  db: Kysely<DB>;
  actor: Pick<SessionUser, "roles">;
  baseURL: string;
  locale: "en" | "nl";
  buildEnv: Readonly<Record<string, string | undefined>>;
}

/** Returns the enabled providers in sign-in page order. */
export async function enabledProviderSettings(
  db: Kysely<DB>,
  baseURL: string,
  locale: "en" | "nl",
): Promise<SystemProvider[]> {
  const rows = await db
    .selectFrom("identity_provider")
    .select([
      "provider_id",
      "label_en",
      "label_nl",
      "protocol",
      "role_claim",
      "role_map",
      "default_role",
    ])
    .where("enabled", "=", true)
    .orderBy("sort_order")
    .orderBy("provider_id")
    .execute();
  return rows.map((row) => {
    const protocol: ProviderProtocol = row.protocol === "saml" ? "saml" : "oidc";
    const urls = providerUrls(baseURL, row.provider_id);
    return {
      providerId: row.provider_id,
      label: locale === "nl" ? row.label_nl : row.label_en,
      protocol,
      callbackUrl: protocol === "saml" ? urls.acsUrl : urls.redirectUri,
      roleClaim: row.role_claim,
      roleMap: [...roleMapOf(row.role_map)]
        .map(([value, role]) => ({ value, role }))
        .sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0)),
      defaultRole: isRole(row.default_role) ? row.default_role : null,
    };
  });
}

/**
 * Returns the system page's configuration.
 *
 * @throws AuthError 403 without the admin role.
 * @throws BuildInfoInvalidError when the image carries a malformed build value.
 */
export async function readSystemConfiguration(
  ctx: SystemReadContext,
): Promise<SystemConfiguration> {
  assertAdmin(ctx.actor);
  return {
    providers: await enabledProviderSettings(ctx.db, ctx.baseURL, ctx.locale),
    build: readBuildInfo(ctx.buildEnv),
  };
}
