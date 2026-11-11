// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The development identity providers `pnpm db:seed` registers through the admin service (#46):
// the dev Keycloak realm's OIDC client as `keycloak` and its SAML client as `keycloak-saml`
// (docker/keycloak/edulims-realm.json). Their client secret is the realm file's public
// development value; the SAML signing key is generated per seed and never committed.
import { generateKeyPairSync } from "node:crypto";
import type { Kysely } from "kysely";
import { IDP_MESSAGE_CODES, idpSchemas } from "../idp/input.ts";
import {
  createProvider,
  type IdpResult,
  type IdpServiceContext,
  setProviderEnabled,
} from "../idp/service.ts";
import type { DB } from "./schema.gen.ts";

/** The realm URL of the development Keycloak (compose.dev.yaml). */
export function devKeycloakRealm(port = process.env["EDULIMS_DEV_KEYCLOAK_PORT"] ?? "8180") {
  return `http://localhost:${port}/realms/edulims`;
}

const ROLE_MAP = [
  { value: "edulims-student", role: "student" },
  { value: "edulims-teacher", role: "teacher" },
  { value: "edulims-admin", role: "admin" },
] as const;

/** Returns the `createProvider` inputs of the two development providers. */
export function devProviderInputs(realm: string, spPrivateKey: string) {
  const schemas = idpSchemas(IDP_MESSAGE_CODES);
  const settings = (labelEn: string, labelNl: string, roleClaim: string, sortOrder: number) => ({
    labelEn,
    labelNl,
    icon: "key-round" as const,
    sortOrder,
    roleClaim,
    roleMap: ROLE_MAP.map((entry) => ({ ...entry })),
    defaultRole: null,
    emailAuthoritative: true,
    domains: [],
  });
  return [
    schemas.createProviderInput.parse({
      providerId: "keycloak",
      protocol: "oidc",
      settings: settings("Keycloak", "Keycloak", "realm_access.roles", 10),
      oidc: { issuer: realm, clientId: "edulims", clientSecret: "edulims-dev-secret" },
    }),
    schemas.createProviderInput.parse({
      providerId: "keycloak-saml",
      protocol: "saml",
      settings: settings("Keycloak (SAML)", "Keycloak (SAML)", "Role", 20),
      saml: {
        metadataXml: "",
        metadataUrl: `${realm}/protocol/saml/descriptor`,
        spPrivateKey,
      },
    }),
  ];
}

/**
 * Registers and enables the development providers that are not there yet. Returns one line per
 * provider; a Keycloak that is not running skips them without failing the seed.
 */
export async function seedDevProviders(
  db: Kysely<DB>,
  ctx: IdpServiceContext,
  realm = devKeycloakRealm(),
): Promise<string[]> {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString().trim();
  const lines: string[] = [];
  for (const input of devProviderInputs(realm, pem)) {
    const existing = await db
      .selectFrom("identity_provider")
      .select("provider_id")
      .where("provider_id", "=", input.providerId)
      .executeTakeFirst();
    if (existing) {
      lines.push(`exists  provider ${input.providerId}`);
      continue;
    }
    const result: IdpResult = await createProvider(ctx, input);
    if (!result.ok) {
      lines.push(`skipped provider ${input.providerId} (${result.error}; is Keycloak running?)`);
      continue;
    }
    await setProviderEnabled(ctx, { providerId: result.providerId, enabled: true });
    lines.push(`created provider ${input.providerId} (enabled)`);
  }
  return lines;
}
