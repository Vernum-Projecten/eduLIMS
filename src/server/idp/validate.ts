// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Server-side checks of an identity provider before it is stored (#46, ADR 0015): the issuer's
// origin (https, and no private or loopback address unless the operator allowed that origin,
// ASVS V1.3.6 SSRF), OIDC discovery with the sso plugin's own validators and PKCE S256, and
// SAML metadata (well-formed, one entity, a signing certificate, an SSO service, a persistent
// NameID). Relative imports: the host CLI loads this in plain Node.
import "@tanstack/react-start/server-only";
import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
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
import { isPrivateAddress } from "./addresses.ts";
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

async function defaultResolve(host: string): Promise<string[]> {
  const records = await lookup(host, { all: true });
  return records.map((record) => record.address);
}

/** The parts of a fetch URL the checks need, after the scheme check. */
function originOf(url: string, policy: OriginPolicy) {
  const parsed = new URL(url);
  const allowed = policy.privateOrigins.includes(parsed.origin);
  if (parsed.protocol !== "https:" && (policy.production || !allowed)) {
    throw new IdpValidationError("issuer_insecure");
  }
  return { parsed, allowed, host: parsed.hostname.replace(/^\[|\]$/g, "") };
}

/** Resolves `host` once and refuses it when any address is private. */
async function publicAddresses(host: string, policy: OriginPolicy): Promise<string[]> {
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : await (policy.resolve ?? defaultResolve)(host);
  } catch (error) {
    throw new IdpValidationError("issuer_unresolvable", { cause: error });
  }
  if (addresses.length === 0) throw new IdpValidationError("issuer_unresolvable");
  if (addresses.some(isPrivateAddress)) throw new IdpValidationError("issuer_private");
  return addresses;
}

/**
 * Checks an issuer URL before eduLIMS fetches it, and returns its origin.
 *
 * @throws IdpValidationError `issuer_insecure` for http in production or off loopback,
 *   `issuer_private` for a private address outside `privateOrigins`, `issuer_unresolvable`.
 */
export async function checkFetchOrigin(url: string, policy: OriginPolicy): Promise<string> {
  const { parsed, allowed, host } = originOf(url, policy);
  if (!allowed) await publicAddresses(host, policy);
  return parsed.origin;
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
 *
 * A document that does not list `code_challenge_methods_supported` is refused with `no_pkce`
 * unless `attestPkce` is set: the administrator's statement that the IdP enforces S256.
 */
export async function discoverOidc(
  issuer: string,
  policy: OriginPolicy,
  options: { attestPkce: boolean } = { attestPkce: false },
): Promise<DiscoveredOidc> {
  const origin = await checkFetchOrigin(issuer, policy);
  const sameOrigin = (url: string) => {
    try {
      return new URL(url).origin === origin;
    } catch {
      return false;
    }
  };
  // NOTE: #92 L3 (ASVS V1.3.6); the fetch trusts only the operator's private origins, so the
  // plugin resolves a public issuer again right before it fetches and refuses a private answer.
  const fetchTrusted = (url: string) => {
    try {
      return policy.privateOrigins.includes(new URL(url).origin);
    } catch {
      return false;
    }
  };
  const discoveryEndpoint = computeDiscoveryUrl(issuer);
  let document: Awaited<ReturnType<typeof fetchDiscoveryDocument>>;
  try {
    const fetched = await fetchDiscoveryDocument(discoveryEndpoint, 10_000, fetchTrusted);
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
    if (error instanceof DiscoveryError && error.code === "discovery_private_host") {
      throw new IdpValidationError("issuer_private", { cause: error });
    }
    if (error instanceof DiscoveryError && error.code === "discovery_untrusted_origin") {
      throw new IdpValidationError("endpoint_foreign_origin", { cause: error });
    }
    throw new IdpValidationError("discovery_failed", { cause: error });
  }
  const endpoints = [document.authorization_endpoint, document.token_endpoint, document.jwks_uri];
  if (!endpoints.every(sameOrigin)) throw new IdpValidationError("endpoint_foreign_origin");
  // NOTE: ASVS V10.2.1; eduLIMS always sends S256, but only an IdP that enforces it stops an
  // injected code. Without the advertised list, the administrator's attestation is the evidence.
  const pkce = document.code_challenge_methods_supported;
  if (pkce === undefined ? !options.attestPkce : !pkce.includes("S256")) {
    throw new IdpValidationError("no_pkce");
  }
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
 * one signing certificate, an HTTP-Redirect SSO service, and the persistent NameID format among
 * the listed `NameIDFormat`s (metadata that lists none is refused).
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
  if (!formats.includes(PERSISTENT_NAME_ID)) {
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

/**
 * Returns the DNS lookup of a metadata fetch: it resolves the host once, refuses a private
 * address, and connects to exactly the addresses it checked (no second resolution).
 */
function checkedLookup(policy: OriginPolicy): LookupFunction {
  return (hostname, options, callback) => {
    publicAddresses(hostname, policy).then(
      (addresses) => {
        const entries = addresses.map((address) => ({ address, family: isIP(address) }));
        const first = entries[0];
        if (options.all) callback(null, entries);
        else if (first) callback(null, first.address, first.family);
        else callback(new IdpValidationError("issuer_unresolvable"), "", 0);
      },
      (error: unknown) =>
        callback(error instanceof Error ? error : new Error(String(error)), "", 0),
    );
  };
}

/** Reads a response body, aborting at {@link MAX_METADATA_BYTES}. */
function readCapped(response: IncomingMessage, abort: () => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    response.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_METADATA_BYTES) {
        abort();
        reject(new IdpValidationError("metadata_too_large"));
        return;
      }
      chunks.push(chunk);
    });
    response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    response.on("error", reject);
  });
}

/**
 * Fetches IdP metadata once from `url`: one DNS resolution checked at connect time, no
 * redirects, 10 seconds at most, and the body streamed up to {@link MAX_METADATA_BYTES}.
 */
export async function fetchSamlMetadata(url: string, policy: OriginPolicy): Promise<string> {
  const { parsed, allowed, host } = originOf(url, policy);
  if (!allowed && isIP(host)) await publicAddresses(host, policy);
  const send = parsed.protocol === "https:" ? httpsRequest : httpRequest;
  try {
    return await new Promise<string>((resolve, reject) => {
      const req = send(
        parsed,
        {
          method: "GET",
          ...(allowed ? {} : { lookup: checkedLookup(policy) }),
          signal: AbortSignal.timeout(10_000),
        },
        (response) => {
          if (response.statusCode !== 200) {
            response.resume();
            reject(new IdpValidationError("metadata_fetch_failed"));
            return;
          }
          readCapped(response, () => req.destroy()).then(resolve, reject);
        },
      );
      req.on("error", reject);
      req.end();
    });
  } catch (error) {
    if (error instanceof IdpValidationError) throw error;
    throw new IdpValidationError("metadata_fetch_failed", { cause: error });
  }
}
