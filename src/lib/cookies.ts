// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

/**
 * The prefix that binds a cookie to the exact origin: the browser accepts it only with
 * `Secure`, `Path=/` and no `Domain`, from an https page (RFC 6265bis §4.1.3.2).
 */
export const HOST_COOKIE_PREFIX = "__Host-";

/**
 * Returns the name cookie `base` has on an origin: `__Host-<base>` over https (production), the
 * bare `base` over plain http, where a browser refuses the prefix (development).
 */
export function hostCookieName(base: string, secure: boolean): string {
  // NOTE: owner decision on #43 (ASVS V3.3.3): the `__Host-` prefix wherever the origin is https.
  return secure ? `${HOST_COOKIE_PREFIX}${base}` : base;
}

/**
 * Returns the `document.cookie` assignment for a preference cookie: the name from
 * {@link hostCookieName}, `Path=/`, no `Domain`, `SameSite=Lax`, and `Secure` over https.
 */
export function preferenceCookie(
  base: string,
  value: string,
  maxAgeSeconds: number,
  secure: boolean,
): string {
  const attributes = ["path=/", `max-age=${maxAgeSeconds}`, "samesite=lax"];
  if (secure) attributes.push("secure");
  return `${hostCookieName(base, secure)}=${value}; ${attributes.join("; ")}`;
}

/**
 * Returns the value of cookie `name` from a `Cookie` header or `document.cookie` string, or
 * `undefined` when it is absent. Values are URI-decoded; a malformed escape yields the raw value.
 */
export function readCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const raw = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}
