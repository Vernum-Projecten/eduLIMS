// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The client IP of a request, for the rate limits of SCIM (#45) and the class join code (#49).
// Relative imports: `pnpm db:seed` loads auth.ts, which loads the SCIM gate.
import "@tanstack/react-start/server-only";
import { getIPFromHeader } from "@better-auth/core/utils/ip";

/**
 * Returns the client IP of a request as better-auth resolves it from `X-Forwarded-For`, walking
 * the chain right to left past `trustedProxies` (`EDULIMS_TRUSTED_PROXIES`), or `null` when no
 * proxy is trusted or no trustworthy address is left. With no trusted proxy no forwarded header is
 * read at all, so a client can never pick its own address (#45, second review, finding 2).
 */
export function clientIpOf(headers: Headers, trustedProxies: readonly string[]): string | null {
  if (trustedProxies.length === 0) return null;
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded === null) return null;
  // NOTE: #49; better-auth's `getIP` answers 127.0.0.1 in development and tests when nothing
  // resolves, so the header parser is called directly: no address means no address.
  return getIPFromHeader(forwarded, { trustedProxies: [...trustedProxies] });
}
