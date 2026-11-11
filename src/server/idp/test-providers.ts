// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Test support: stores an identity provider straight into the test database, with its secrets
// sealed as the admin service seals them but without discovery, so tests need no network.
import { readFileSync } from "node:fs";
import type { Kysely } from "kysely";
import type { ProviderProtocol } from "../../lib/identity-providers.ts";
import type { DB } from "../db/schema.gen.ts";
import { type Keyring, sealConfig } from "./crypto.ts";
import { buildOidcConfig, buildSamlConfig, pluginDomain, providerUrls } from "./provider-config.ts";
import { invalidateProviderCache } from "./registry.ts";
import { parseSamlMetadata } from "./validate.ts";

/** The settings of a test provider; every field has a default. */
export interface TestProvider {
  providerId: string;
  protocol?: ProviderProtocol;
  enabled?: boolean;
  issuer?: string;
  clientSecret?: string;
  roleClaim?: string;
  roleMap?: Readonly<Record<string, string>>;
  defaultRole?: string | null;
  emailAuthoritative?: boolean;
  endSessionEndpoint?: string | null;
  domains?: readonly string[];
  labelEn?: string;
  labelNl?: string;
  /** SAML only: the IdP metadata XML, and the base URL of the SP entity ID. */
  samlMetadata?: string;
  baseURL?: string;
}

/** The synthetic IdP metadata of the test fixtures. */
export function fixtureMetadata(): string {
  return readFileSync(
    new URL("../../../tests/fixtures/idp/saml-idp-metadata.xml", import.meta.url),
    "utf8",
  );
}

/**
 * Stores a test provider, enabled by default: OIDC with discovered endpoints on its issuer, or
 * SAML from `samlMetadata` (the fixture IdP's when absent).
 */
export async function insertTestProvider(
  db: Kysely<DB>,
  keyring: Keyring,
  input: TestProvider,
): Promise<void> {
  const issuer = input.issuer ?? "https://idp.example.test";
  const config = buildOidcConfig({
    issuer,
    clientId: `${input.providerId}-client`,
    clientSecret: input.clientSecret ?? "test-client-secret",
    discovered: {
      discoveryEndpoint: `${issuer}/.well-known/openid-configuration`,
      authorizationEndpoint: `${issuer}/authorize`,
      tokenEndpoint: `${issuer}/token`,
      jwksEndpoint: `${issuer}/jwks`,
      tokenEndpointAuthentication: "client_secret_basic",
      endSessionEndpoint: input.endSessionEndpoint ?? null,
    },
  });
  const saml = input.protocol === "saml";
  const spEntityId = providerUrls(
    input.baseURL ?? "http://localhost:3000",
    input.providerId,
  ).spEntityId;
  const samlConfig = saml
    ? JSON.stringify(
        buildSamlConfig({
          spEntityId,
          metadataXml: input.samlMetadata ?? fixtureMetadata(),
          parsed: parseSamlMetadata(input.samlMetadata ?? fixtureMetadata()),
          spPrivateKey: null,
        }),
      )
    : null;
  await db
    .insertInto("ssoProvider")
    .values({
      id: `sso-${input.providerId}`,
      issuer: saml ? spEntityId : issuer,
      oidcConfig: saml
        ? null
        : sealConfig(keyring, input.providerId, "oidcConfig", JSON.stringify(config)),
      samlConfig: samlConfig
        ? sealConfig(keyring, input.providerId, "samlConfig", samlConfig)
        : null,
      providerId: input.providerId,
      domain: pluginDomain(input.providerId),
    })
    .execute();
  await db
    .insertInto("identity_provider")
    .values({
      provider_id: input.providerId,
      protocol: input.protocol ?? "oidc",
      enabled: input.enabled ?? true,
      label_en: input.labelEn ?? input.providerId,
      label_nl: input.labelNl ?? input.providerId,
      role_claim: input.roleClaim ?? "roles",
      role_map: JSON.stringify(
        input.roleMap ?? {
          "edulims-student": "student",
          "edulims-teacher": "teacher",
          "edulims-admin": "admin",
        },
      ),
      default_role: input.defaultRole ?? null,
      email_authoritative: input.emailAuthoritative ?? false,
      end_session_endpoint: input.endSessionEndpoint ?? null,
    })
    .execute();
  if (input.domains && input.domains.length > 0) {
    await db
      .insertInto("identity_provider_domain")
      .values(input.domains.map((domain) => ({ domain, provider_id: input.providerId })))
      .execute();
  }
  invalidateProviderCache();
}
