// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The form model of the add and edit provider forms (#46): one shape for both protocols, checked
// with the server's own schema parts, and turned into the server function's input on submit.
import { z } from "zod";
import { PROVIDER_PROTOCOLS, type ProviderProtocol } from "@/lib/identity-providers";
import {
  type CreateProviderInput,
  createOidcProviderInput,
  createSamlProviderInput,
  oidcConfigSchema,
  type ProviderSettings,
  providerIdSchema,
  providerSettingsSchema,
  samlConfigSchema,
  type UpdateProviderInput,
} from "@/server/idp/schemas";

/** The values of the provider form. */
export interface ProviderFormValues {
  providerId: string;
  protocol: ProviderProtocol;
  settings: ProviderSettings;
  oidc: { issuer: string; clientId: string; clientSecret: string };
  saml: { metadataXml: string; metadataUrl: string; spPrivateKey: string };
}

/** Returns the form schema for adding (`create`) or editing a provider of `protocol`. */
export function providerFormSchema(mode: "create" | "edit", protocol: ProviderProtocol) {
  const create = mode === "create";
  return z.object({
    providerId: providerIdSchema,
    protocol: z.enum(PROVIDER_PROTOCOLS),
    settings: providerSettingsSchema,
    oidc:
      protocol === "oidc"
        ? create
          ? createOidcProviderInput.shape.oidc
          : oidcConfigSchema
        : z.object({ issuer: z.string(), clientId: z.string(), clientSecret: z.string() }),
    saml:
      protocol === "saml"
        ? create
          ? createSamlProviderInput.shape.saml
          : samlConfigSchema
        : z.object({ metadataXml: z.string(), metadataUrl: z.string(), spPrivateKey: z.string() }),
  });
}

/** Returns the empty form for a new provider of `protocol`. */
export function emptyProviderForm(protocol: ProviderProtocol): ProviderFormValues {
  return {
    providerId: "",
    protocol,
    settings: {
      labelEn: "",
      labelNl: "",
      icon: "key-round",
      sortOrder: 0,
      roleClaim: protocol === "oidc" ? "roles" : "Role",
      roleMap: [],
      defaultRole: null,
      emailAuthoritative: false,
      domains: [],
    },
    oidc: { issuer: "", clientId: "", clientSecret: "" },
    saml: { metadataXml: "", metadataUrl: "", spPrivateKey: "" },
  };
}

/** Returns the input of `createIdentityProvider` for the form values. */
export function toCreateInput(values: ProviderFormValues): CreateProviderInput {
  const base = { providerId: values.providerId, settings: values.settings };
  return values.protocol === "oidc"
    ? { ...base, protocol: "oidc", oidc: values.oidc }
    : { ...base, protocol: "saml", saml: values.saml };
}

/** Returns the input of `updateIdentityProvider` for the form values. */
export function toUpdateInput(values: ProviderFormValues): UpdateProviderInput {
  return toCreateInput(values);
}

/** Splits the domains text area into its domains: one per line, blank lines dropped. */
export function domainsFromText(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line !== "");
}
