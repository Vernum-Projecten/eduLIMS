// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The sso plugin's provider configuration as eduLIMS writes it (#46, ADR 0015). Pure: no I/O.
// The fixed settings are the security decisions of the design: PKCE always, the scopes without
// `offline_access`, no UserInfo endpoint (claims come from the verified ID token), signed SAML
// assertions and the persistent NameID. Relative imports: the host CLI loads this.
import type { OIDCConfig, SAMLConfig } from "@better-auth/sso";
import { type DiscoveredOidc, type ParsedSamlMetadata, PERSISTENT_NAME_ID } from "./validate.ts";

/** The scopes every OIDC provider gets: no refresh token, eduLIMS never calls the IdP again. */
export const OIDC_SCOPES = ["openid", "email", "profile"] as const;

/** The better-auth base path the handler is mounted on (`src/routes/api/auth/$.ts`). */
export const AUTH_BASE_PATH = "/api/auth";

/** The URLs an administrator registers at the identity provider, per protocol. */
export interface ProviderUrls {
  /** OIDC: the redirect (callback) URI. */
  redirectUri: string;
  /** OIDC: the post-logout redirect URI (RP-initiated logout). */
  postLogoutRedirectUri: string;
  /** SAML: the assertion consumer service URL. */
  acsUrl: string;
  /** SAML: the SP entity ID, which is also the SP metadata URL. */
  spEntityId: string;
  spMetadataUrl: string;
}

/** Returns the URLs of one provider under `baseURL` (`BETTER_AUTH_URL`). */
export function providerUrls(baseURL: string, providerId: string): ProviderUrls {
  const auth = `${baseURL.replace(/\/$/, "")}${AUTH_BASE_PATH}`;
  const spMetadataUrl = `${auth}/sso/saml2/sp/metadata?providerId=${encodeURIComponent(providerId)}`;
  return {
    redirectUri: `${auth}/sso/callback/${providerId}`,
    postLogoutRedirectUri: `${baseURL.replace(/\/$/, "")}/login`,
    acsUrl: `${auth}/sso/saml2/sp/acs/${providerId}`,
    spEntityId: spMetadataUrl,
    spMetadataUrl,
  };
}

/** Returns the `oidcConfig` of a provider: discovered endpoints, PKCE, fixed scopes. */
export function buildOidcConfig(input: {
  issuer: string;
  clientId: string;
  clientSecret: string;
  discovered: DiscoveredOidc;
}): OIDCConfig {
  const { discovered } = input;
  return {
    issuer: input.issuer,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    pkce: true,
    scopes: [...OIDC_SCOPES],
    discoveryEndpoint: discovered.discoveryEndpoint,
    authorizationEndpoint: discovered.authorizationEndpoint,
    tokenEndpoint: discovered.tokenEndpoint,
    jwksEndpoint: discovered.jwksEndpoint,
    tokenEndpointAuthentication: discovered.tokenEndpointAuthentication,
    overrideUserInfo: true,
  };
}

/** Returns the `samlConfig` of a provider: signed assertions and the persistent NameID forced. */
export function buildSamlConfig(input: {
  spEntityId: string;
  metadataXml: string;
  parsed: ParsedSamlMetadata;
  spPrivateKey: string | null;
}): SAMLConfig {
  return {
    issuer: input.spEntityId,
    entryPoint: input.parsed.ssoUrl,
    idpMetadata: { metadata: input.metadataXml },
    wantAssertionsSigned: true,
    authnRequestsSigned: input.spPrivateKey !== null,
    identifierFormat: PERSISTENT_NAME_ID,
    ...(input.spPrivateKey ? { spMetadata: { privateKey: input.spPrivateKey } } : {}),
  };
}

/**
 * The domain the plugin's own `ssoProvider.domain` column holds. eduLIMS routes by its own
 * domain table and refuses `/sign-in/sso` without a provider id, so this never matches an email.
 */
export function pluginDomain(providerId: string): string {
  return `${providerId}.provider.invalid`;
}
