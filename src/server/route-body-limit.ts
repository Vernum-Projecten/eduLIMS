// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The size limit of a body sent to a server route (ASVS 5.0 V5.2.1, V15.2.2, #350): the
// better-auth handler under `/api/auth/*`, with its SAML endpoints and SCIM, and every other
// route, which takes no body at all. A request middleware checks the declared length, then counts
// the body on a clone with the counter of the server function limit, before the route reads it;
// a SCIM body is counted later, by the SCIM gate.
import { logBodyRefusal } from "./body-refusal-log.ts";
import { BODY_REFUSAL_HEADERS, fitsIn } from "./json-body-limit.ts";
import { SCIM_LIMITS, scimErrorResponse } from "./scim/limits.ts";

/** The groups of server routes that share one body limit. */
export type RouteBodyFamily = "auth" | "saml" | "scim" | "none";

// NOTE: #350; the browser sends `/sign-in/sso`, `/sign-in/email` (development) and `/sign-out`,
// whose largest field is a callback URL, which Node's 16 KiB header limit already bounds.
/** The most bytes a JSON body to a better-auth endpoint other than SAML and SCIM may carry. */
export const AUTH_BODY_MAX = 64 * 1024;

// NOTE: maintainer decision on #350; our own margin over the dev Keycloak's measured 10 KB form,
// which an operator raises if their IdP sends more.
/** The most bytes a SAML form post (the ACS and single logout) may carry. */
export const SAML_BODY_MAX = 128 * 1024;

/** The most bytes a SCIM request may declare here and carry past the SCIM gate (#45). */
export const SCIM_BODY_MAX = SCIM_LIMITS.maxBodyBytes;

const AUTH_BASE = "/api/auth/";

/** A declared length: digits only, short enough to be an exact JavaScript number. */
const LENGTH = /^\d{1,15}$/;

/**
 * Returns the body family of a server route from the raw path of its URL (`new URL(url).pathname`,
 * still percent-encoded), the path the better-auth router and the SCIM gate match. A path that
 * spells a family's prefix with escapes (`/api/auth/s%73o/…`) falls to `auth`, so a body can only
 * ever meet the smaller limit.
 */
export function routeBodyFamily(pathname: string): RouteBodyFamily {
  if (!pathname.startsWith(AUTH_BASE)) return "none";
  const rest = pathname.slice(AUTH_BASE.length);
  if (rest.startsWith("sso/saml2/")) return "saml";
  if (rest === "scim/v2" || rest.startsWith("scim/v2/")) return "scim";
  return "auth";
}

/** Returns the body limit of a family: 0 for a route that takes no body. */
export function routeBodyLimit(family: RouteBodyFamily): number {
  switch (family) {
    case "auth":
      return AUTH_BODY_MAX;
    case "saml":
      return SAML_BODY_MAX;
    case "scim":
      return SCIM_BODY_MAX;
    case "none":
      return 0;
    default: {
      const unknown: never = family;
      return unknown;
    }
  }
}

/**
 * Returns the status that refuses the body of `request` to a server route of `family`, or `null`
 * to let it through: 411 for a malformed `Content-Length`; 413 for a declared length over the
 * limit, a chunked GET or HEAD, a chunked body to a route that takes none, or a body that streams
 * past the limit. A SCIM body is checked on its declared length only; the SCIM gate counts it.
 */
export async function routeBodyRefusal(
  request: Request,
  family: RouteBodyFamily,
): Promise<411 | 413 | null> {
  const limit = routeBodyLimit(family);
  const declared = request.headers.get("content-length")?.trim();
  if (declared !== undefined) {
    if (!LENGTH.test(declared)) return 411;
    if (Number(declared) > limit) return 413;
  }
  const chunked = request.headers.has("transfer-encoding");
  const method = request.method.toUpperCase();
  if (chunked && (method === "GET" || method === "HEAD" || limit === 0)) return 413;
  // NOTE: maintainer decision on #350 (S1); the gate counts a SCIM body after the token check and
  // the rate limit, so a caller without a token is limited before a byte of its body is read.
  if (family === "scim") return null;
  if (request.body === null) return null;
  // NOTE: #350; IdPs send these bodies, and their framing is not eduLIMS's to choose, so a
  // chunked body is counted to the limit where a server function would get 411.
  return (await fitsIn(request, request.clone(), limit)) ? null : 413;
}

/**
 * Returns the refusal response for the body of `request` to a server route and logs it through
 * the deduplicated body refusal log, or `null`. The response closes the connection; a SCIM
 * refusal is a SCIM error (RFC 7644 §3.12).
 */
export async function refuseRouteBody(request: Request): Promise<Response | null> {
  const family = routeBodyFamily(new URL(request.url).pathname);
  const status = await routeBodyRefusal(request, family);
  if (status === null) return null;
  logBodyRefusal(request, {
    reason: status === 411 ? "route_length_invalid" : "route_body_too_large",
    kind: family,
    status,
  });
  if (family === "scim") {
    const detail = status === 411 ? "Content-Length is not valid" : "Request body too large";
    return scimErrorResponse(status, detail, BODY_REFUSAL_HEADERS);
  }
  return new Response(null, { status, headers: BODY_REFUSAL_HEADERS });
}
