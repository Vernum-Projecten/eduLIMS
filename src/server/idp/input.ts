// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The input rules of an identity provider (#46, ADR 0015), built once with translated messages
// for the Admin screen (schemas.ts) and once with message codes for the host CLI, which runs
// where the compiled message catalogue is not (the migrate image). Relative imports: plain Node.
import { z } from "zod";
import {
  PROVIDER_ICONS,
  PROVIDER_ID_PATTERN,
  RESERVED_PROVIDER_IDS,
} from "../../lib/identity-providers.ts";
import { ROLES } from "../../lib/roles.ts";

/** The largest IdP metadata XML eduLIMS accepts (the sso plugin's `maxMetadataSize`, 100 KB). */
export const MAX_METADATA_BYTES = 100 * 1024;

/** The most role-map entries and email domains one provider can have. */
export const MAX_ROLE_MAP_ENTRIES = 50;
export const MAX_DOMAINS = 20;

const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** The messages the input rules need, one function per refusal. */
export interface IdpMessages {
  idp_error_client_id: () => string;
  idp_error_client_secret: () => string;
  idp_error_domain: () => string;
  idp_error_domain_duplicate: () => string;
  idp_error_issuer: () => string;
  idp_error_label: () => string;
  idp_error_metadata_required: () => string;
  idp_error_metadata_size: () => string;
  idp_error_metadata_url: () => string;
  idp_error_pem: () => string;
  idp_error_provider_id: () => string;
  idp_error_role_claim: () => string;
  idp_error_role_map_duplicate: () => string;
  idp_error_role_value: () => string;
  validation_email: () => string;
}

/** The message codes themselves, for the host CLI. */
export const IDP_MESSAGE_CODES: IdpMessages = {
  idp_error_client_id: () => "idp_error_client_id",
  idp_error_client_secret: () => "idp_error_client_secret",
  idp_error_domain: () => "idp_error_domain",
  idp_error_domain_duplicate: () => "idp_error_domain_duplicate",
  idp_error_issuer: () => "idp_error_issuer",
  idp_error_label: () => "idp_error_label",
  idp_error_metadata_required: () => "idp_error_metadata_required",
  idp_error_metadata_size: () => "idp_error_metadata_size",
  idp_error_metadata_url: () => "idp_error_metadata_url",
  idp_error_pem: () => "idp_error_pem",
  idp_error_provider_id: () => "idp_error_provider_id",
  idp_error_role_claim: () => "idp_error_role_claim",
  idp_error_role_map_duplicate: () => "idp_error_role_map_duplicate",
  idp_error_role_value: () => "idp_error_role_value",
  validation_email: () => "validation_email",
};

/** Returns the provider input schemas with `msg` as their messages. */
export function idpSchemas(msg: IdpMessages) {
  /** A provider id: a slug that is not reserved; immutable once created. */
  const providerIdSchema = z
    .string()
    .trim()
    .regex(PROVIDER_ID_PATTERN, { error: () => msg.idp_error_provider_id() })
    .refine((id) => !RESERVED_PROVIDER_IDS.has(id), { error: () => msg.idp_error_provider_id() });

  /** One line of the role map: an IdP role or group value and the eduLIMS role it grants. */
  const roleMapEntrySchema = z.strictObject({
    value: z
      .string()
      .trim()
      .min(1, { error: () => msg.idp_error_role_value() })
      .max(200),
    role: z.enum(ROLES),
  });

  const PRIVATE_KEY_PEM =
    /^-----BEGIN (RSA )?PRIVATE KEY-----[\s\S]+-----END (RSA )?PRIVATE KEY-----$/;

  const pem = () =>
    z
      .string()
      .trim()
      .max(20_000)
      .refine((text) => text === "" || PRIVATE_KEY_PEM.test(text), {
        error: () => msg.idp_error_pem(),
      });

  /** The settings every provider has, whatever its protocol. */
  const providerSettingsSchema = z.strictObject({
    labelEn: z
      .string()
      .trim()
      .min(1, { error: () => msg.idp_error_label() })
      .max(60, { error: () => msg.idp_error_label() }),
    labelNl: z
      .string()
      .trim()
      .min(1, { error: () => msg.idp_error_label() })
      .max(60, { error: () => msg.idp_error_label() }),
    icon: z.enum(PROVIDER_ICONS),
    sortOrder: z.number().int().min(0).max(999),
    roleClaim: z
      .string()
      .trim()
      .min(1, { error: () => msg.idp_error_role_claim() })
      .max(200, { error: () => msg.idp_error_role_claim() })
      .regex(/^\S+$/, { error: () => msg.idp_error_role_claim() }),
    roleMap: z
      .array(roleMapEntrySchema)
      .max(MAX_ROLE_MAP_ENTRIES)
      .refine((entries) => new Set(entries.map((entry) => entry.value)).size === entries.length, {
        error: () => msg.idp_error_role_map_duplicate(),
      }),
    defaultRole: z.enum(ROLES).nullable(),
    emailAuthoritative: z.boolean(),
    domains: z
      .array(
        z
          .string()
          .trim()
          .toLowerCase()
          .regex(DOMAIN, { error: () => msg.idp_error_domain() }),
      )
      .max(MAX_DOMAINS)
      .refine((domains) => new Set(domains).size === domains.length, {
        error: () => msg.idp_error_domain_duplicate(),
      }),
  });

  /** The protocol part of an OIDC provider. PKCE and the scopes are fixed, never input. */
  const oidcConfigSchema = z.strictObject({
    issuer: z.url({ protocol: /^https?$/, error: () => msg.idp_error_issuer() }),
    clientId: z
      .string()
      .trim()
      .min(1, { error: () => msg.idp_error_client_id() })
      .max(200),
    /** Write-only: empty on an edit keeps the stored secret. */
    clientSecret: z.string().max(1000),
    /**
     * The administrator's statement that the IdP enforces PKCE S256 although its discovery
     * document does not say so (ASVS V10.2.1). Off unless set.
     */
    attestPkce: z.boolean(),
  });

  /** The protocol part of a SAML provider: IdP metadata as XML or as a URL fetched once. */
  const samlConfigSchema = z.strictObject({
    metadataXml: z.string().max(MAX_METADATA_BYTES, { error: () => msg.idp_error_metadata_size() }),
    metadataUrl: z.union([
      z.literal(""),
      z.url({ protocol: /^https?$/, error: () => msg.idp_error_metadata_url() }),
    ]),
    /**
     * Write-only: the optional SP private key that signs AuthnRequests; the IdP holds its
     * certificate. Empty on an edit keeps the stored key.
     */
    spPrivateKey: pem(),
  });

  /** The input that creates an OIDC provider. */
  const createOidcProviderInput = z.strictObject({
    providerId: providerIdSchema,
    protocol: z.literal("oidc"),
    settings: providerSettingsSchema,
    oidc: oidcConfigSchema.refine((config) => config.clientSecret.trim() !== "", {
      error: () => msg.idp_error_client_secret(),
      path: ["clientSecret"],
    }),
  });

  /** The input that creates a SAML provider; it needs metadata XML or a metadata URL. */
  const createSamlProviderInput = z.strictObject({
    providerId: providerIdSchema,
    protocol: z.literal("saml"),
    settings: providerSettingsSchema,
    saml: samlConfigSchema.refine(
      (config) => config.metadataXml.trim() !== "" || config.metadataUrl !== "",
      { error: () => msg.idp_error_metadata_required(), path: ["metadataXml"] },
    ),
  });

  /** The input of `createIdentityProvider`. */
  const createProviderInput = z.discriminatedUnion("protocol", [
    createOidcProviderInput,
    createSamlProviderInput,
  ]);

  /** The input that edits a provider: everything but its id and protocol. */
  const updateProviderInput = z.discriminatedUnion("protocol", [
    z.strictObject({
      providerId: providerIdSchema,
      protocol: z.literal("oidc"),
      settings: providerSettingsSchema,
      oidc: oidcConfigSchema,
    }),
    z.strictObject({
      providerId: providerIdSchema,
      protocol: z.literal("saml"),
      settings: providerSettingsSchema,
      saml: samlConfigSchema,
    }),
  ]);

  /** The input that names one provider. */
  const providerIdInput = z.strictObject({ providerId: providerIdSchema });

  /** The input that enables or disables one provider. */
  const setProviderEnabledInput = z.strictObject({
    providerId: providerIdSchema,
    enabled: z.boolean(),
  });

  /** The input that reads the outcome of one test sign-in. */
  const testResultInput = z.strictObject({
    providerId: providerIdSchema,
    test: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
  });

  /** The input of the login page's "Sign in with your institution email". */
  const institutionEmailInput = z.strictObject({
    email: z.email({ error: () => msg.validation_email() }).max(254),
  });

  return {
    providerIdSchema,
    roleMapEntrySchema,
    providerSettingsSchema,
    oidcConfigSchema,
    samlConfigSchema,
    createOidcProviderInput,
    createSamlProviderInput,
    createProviderInput,
    updateProviderInput,
    providerIdInput,
    setProviderEnabledInput,
    testResultInput,
    institutionEmailInput,
  };
}
