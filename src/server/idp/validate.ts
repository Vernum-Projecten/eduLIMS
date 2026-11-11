// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Server-side checks of an identity provider before it is stored (#46, ADR 0015): the issuer's
// origin (https, and no private or loopback address unless the operator allowed that origin,
// ASVS V1.3.6 SSRF), OIDC discovery with the sso plugin's own validators, and SAML metadata
// (well-formed, one entity, a signing certificate, an SSO service, a persistent NameID).
// Relative imports: the host CLI loads this in plain Node.
import "@tanstack/react-start/server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  computeDiscoveryUrl,
  DiscoveryError,
  fetchDiscoveryDocument,
  normalizeDiscoveryUrls,
  type OIDCDiscoveryDocument,
  selectTokenEndpointAuthMethod,
  validateDiscoveryDocument,
} from "@better-auth/sso";
import { IdPMetadata } from "samlify";
import { MAX_METADATA_BYTES } from "./input.ts";

/** Why a provider configuration was refused; the screen translates the code. */
export type IdpValidationProblem =
  | "issuer_insecure"
  | "issuer_private"
  | "issuer_unresolvable"
  | "discovery_failed"
  | "issuer_mismatch"
  | "endpoint_foreign_origin"
  | "no_pkce"
  | "unsupported_client_auth"
  | "metadata_fetch_failed"
  | "metadata_too_large"
  | "metadata_invalid"
  | "metadata_no_signing_cert"
  | "metadata_no_sso_service"
  | "metadata_no_persistent_nameid";

/** Thrown when a provider configuration fails a check; carries a code, never a secret. */
export class IdpValidationError extends Error {
  readonly kind: IdpValidationProblem;
  constructor(kind: IdpValidationProblem, options?: { cause?: unknown }) {
    super(`identity provider refused: ${kind}`, options);
    this.name = "IdpValidationError";
    this.kind = kind;
  }
}

/** Where providers may live: the production switch and the operator's private origins. */
export interface OriginPolicy {
  production: boolean;
  /** `EDULIMS_IDP_PRIVATE_ORIGINS`: origins allowed to resolve to private addresses. */
  privateOrigins: readonly string[];
  /** Resolves a host name; tests replace it. */
  resolve?: (host: string) => Promise<string[]>;
}

function ipv4Private(address: string): boolean {
  const [a = -1, b = -1] = address.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** Returns whether an IP address is not publicly routable (loopback, RFC 1918, link-local, ULA). */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return ipv4Private(address);
  if (version !== 6) return true;
  const lower = address.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped?.[1]) return ipv4Private(mapped[1]);
  return (
    lower === "::" ||
    lower === "::1" ||
    /^f[cd]/.test(lower) ||
    /^fe[89ab]/.test(lower) ||
    lower.startsWith("ff")
  );
}

async function defaultResolve(host: string): Promise<string[]> {
  const records = await lookup(host, { all: true });
  return records.map((record) => record.address);
}

/**
 * Checks an issuer or metadata URL before eduLIMS fetches it, and returns its origin.
 *
 * @throws IdpValidationError `issuer_insecure` for http in production or off loopback,
 *   `issuer_private` for a private address outside `privateOrigins`, `issuer_unresolvable`.
 */
export async function checkFetchOrigin(url: string, policy: OriginPolicy): Promise<string> {
  const parsed = new URL(url);
  const origin = parsed.origin;
  const allowed = policy.privateOrigins.includes(origin);
  if (parsed.protocol !== "https:" && (policy.production || !allowed)) {
    throw new IdpValidationError("issuer_insecure");
  }
  if (allowed) return origin;
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : await (policy.resolve ?? defaultResolve)(host);
  } catch (error) {
    throw new IdpValidationError("issuer_unresolvable", { cause: error });
  }
  if (addresses.length === 0) throw new IdpValidationError("issuer_unresolvable");
  if (addresses.some(isPrivateAddress)) throw new IdpValidationError("issuer_private");
  return origin;
}

/** The discovered endpoints eduLIMS stores; no `userInfoEndpoint`, so claims come from the ID token. */
export interface DiscoveredOidc {
  discoveryEndpoint: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksEndpoint: string;
  tokenEndpointAuthentication: "client_secret_basic" | "client_secret_post";
  endSessionEndpoint: string | null;
}

/**
 * Runs OIDC discovery for `issuer` with the sso plugin's validators (exact issuer match, the
 * required fields), and requires every endpoint on the issuer's own origin and PKCE S256.
 */
export async function discoverOidc(issuer: string, policy: OriginPolicy): Promise<DiscoveredOidc> {
  const origin = await checkFetchOrigin(issuer, policy);
  const sameOrigin = (url: string) => {
    try {
      return new URL(url).origin === origin;
    } catch {
      return false;
    }
  };
  const discoveryEndpoint = computeDiscoveryUrl(issuer);
  let document: Awaited<ReturnType<typeof fetchDiscoveryDocument>>;
  try {
    const fetched = await fetchDiscoveryDocument(discoveryEndpoint, 10_000, sameOrigin);
    validateDiscoveryDocument(fetched, issuer);
    // Only the endpoints eduLIMS stores are checked: an unused UserInfo endpoint may live on
    // another origin (Entra ID's is on Microsoft Graph).
    const used: OIDCDiscoveryDocument = {
      issuer: fetched.issuer,
      authorization_endpoint: fetched.authorization_endpoint,
      token_endpoint: fetched.token_endpoint,
      jwks_uri: fetched.jwks_uri,
      ...(fetched.code_challenge_methods_supported
        ? { code_challenge_methods_supported: fetched.code_challenge_methods_supported }
        : {}),
      ...(fetched.token_endpoint_auth_methods_supported
        ? { token_endpoint_auth_methods_supported: fetched.token_endpoint_auth_methods_supported }
        : {}),
      ...(typeof fetched.end_session_endpoint === "string" &&
      sameOrigin(fetched.end_session_endpoint)
        ? { end_session_endpoint: fetched.end_session_endpoint }
        : {}),
    };
    document = normalizeDiscoveryUrls(used, issuer, sameOrigin);
  } catch (error) {
    if (error instanceof DiscoveryError && error.code === "issuer_mismatch") {
      throw new IdpValidationError("issuer_mismatch", { cause: error });
    }
    if (error instanceof DiscoveryError && error.code === "discovery_untrusted_origin") {
      throw new IdpValidationError("endpoint_foreign_origin", { cause: error });
    }
    throw new IdpValidationError("discovery_failed", { cause: error });
  }
  const endpoints = [document.authorization_endpoint, document.token_endpoint, document.jwks_uri];
  if (!endpoints.every(sameOrigin)) throw new IdpValidationError("endpoint_foreign_origin");
  const pkce = document.code_challenge_methods_supported;
  if (pkce !== undefined && !pkce.includes("S256")) throw new IdpValidationError("no_pkce");
  const method = selectTokenEndpointAuthMethod(document);
  if (method === "private_key_jwt") throw new IdpValidationError("unsupported_client_auth");
  const endSession = document.end_session_endpoint;
  return {
    discoveryEndpoint,
    authorizationEndpoint: document.authorization_endpoint,
    tokenEndpoint: document.token_endpoint,
    jwksEndpoint: document.jwks_uri,
    tokenEndpointAuthentication: method,
    endSessionEndpoint:
      typeof endSession === "string" && sameOrigin(endSession) ? endSession : null,
  };
}

/** The SAML NameID format eduLIMS requires: the account key must not change between sign-ins. */
export const PERSISTENT_NAME_ID = "urn:oasis:names:tc:SAML:2.0:nameid-format:persistent";

const REDIRECT_BINDING = "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect";

/** What eduLIMS reads from IdP metadata. */
export interface ParsedSamlMetadata {
  entityId: string;
  ssoUrl: string;
  /** Whether the IdP offers single logout (`SingleLogoutService`). */
  singleLogout: boolean;
}

/**
 * Checks IdP metadata XML: size, one well-formed `EntityDescriptor` with an IdP role, at least
 * one signing certificate, an HTTP-Redirect SSO service, and the persistent NameID format when
 * the metadata lists formats at all.
 */
export function parseSamlMetadata(xml: string): ParsedSamlMetadata {
  if (Buffer.byteLength(xml, "utf8") > MAX_METADATA_BYTES) {
    throw new IdpValidationError("metadata_too_large");
  }
  if (/<!DOCTYPE/i.test(xml) || !/IDPSSODescriptor/.test(xml)) {
    throw new IdpValidationError("metadata_invalid");
  }
  let metadata: ReturnType<typeof IdPMetadata>;
  try {
    metadata = IdPMetadata(xml);
  } catch (error) {
    throw new IdpValidationError("metadata_invalid", { cause: error });
  }
  const entityId = metadata.getEntityID();
  if (typeof entityId !== "string" || entityId === "") {
    throw new IdpValidationError("metadata_invalid");
  }
  const signing = metadata.getX509Certificate("signing");
  if (!signing || (Array.isArray(signing) && signing.length === 0)) {
    throw new IdpValidationError("metadata_no_signing_cert");
  }
  const sso = serviceLocation(metadata.getSingleSignOnService(REDIRECT_BINDING), REDIRECT_BINDING);
  if (sso === null || !/^https?:\/\//.test(sso)) {
    throw new IdpValidationError("metadata_no_sso_service");
  }
  const listed: unknown = metadata.getNameIDFormat();
  const formats = typeof listed === "string" ? [listed] : Array.isArray(listed) ? listed : [];
  if (formats.length > 0 && !formats.includes(PERSISTENT_NAME_ID)) {
    throw new IdpValidationError("metadata_no_persistent_nameid");
  }
  const slo = serviceLocation(metadata.getSingleLogoutService(REDIRECT_BINDING), REDIRECT_BINDING);
  return { entityId, ssoUrl: sso, singleLogout: slo !== null };
}

/**
 * Returns the location of a metadata service for `binding`: samlify gives one location as a
 * string, several as a binding-to-location map (SSO) or as `{ binding, location }` entries (SLO).
 */
export function serviceLocation(value: unknown, binding: string): string | null {
  if (typeof value === "string") return value === "" ? null : value;
  if (Array.isArray(value)) {
    const entry: unknown = value.find((item) => Reflect.get(Object(item), "binding") === binding);
    const location: unknown = Reflect.get(Object(entry), "location");
    return typeof location === "string" && location !== "" ? location : null;
  }
  if (typeof value === "object" && value !== null) {
    const entry: unknown = Reflect.get(value, "binding") === binding ? value : null;
    const location: unknown = entry
      ? Reflect.get(Object(entry), "location")
      : Reflect.get(value, binding);
    return typeof location === "string" && location !== "" ? location : null;
  }
  return null;
}

/** Fetches IdP metadata once from `url` after the origin check, without following redirects. */
export async function fetchSamlMetadata(url: string, policy: OriginPolicy): Promise<string> {
  await checkFetchOrigin(url, policy);
  let response: Response;
  try {
    response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    throw new IdpValidationError("metadata_fetch_failed", { cause: error });
  }
  if (!response.ok) throw new IdpValidationError("metadata_fetch_failed");
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_METADATA_BYTES) {
    throw new IdpValidationError("metadata_too_large");
  }
  return text;
}
