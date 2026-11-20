// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

/** A fresh base64 nonce for the Content-Security-Policy of one response. */
export function createNonce(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
}

/** Headers a production response always carries, even when the handler set its own value. */
const ENFORCED_HEADERS = new Set(["cache-control"]);

/**
 * Security headers for every response the Start handler serves (pages, server functions,
 * server routes; built assets are served before it and keep their long cache). CSP, HSTS and
 * `Cache-Control: no-store` are only sent by production builds: the Vite dev server injects
 * inline scripts without a nonce and runs on plain HTTP.
 */
export function securityHeaders(options: { nonce: string; production: boolean }): Headers {
  const headers = new Headers({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin",
  });
  if (options.production) {
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'nonce-${options.nonce}'`,
      // Radix and Sonner position elements with inline style attributes.
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
    ];
    headers.set("Content-Security-Policy", csp.join("; "));
    headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
    // NOTE: owner decision on #41 (ASVS V14.3.2): any of these responses may depend on the
    // session, so no shared or back-button cache keeps one (shared lab computers).
    headers.set("Cache-Control", "no-store");
  }
  return headers;
}

/**
 * Copies the security headers onto a response, keeping headers the handler already set, except
 * `Cache-Control`, which the security headers decide whenever they carry it.
 */
export function withSecurityHeaders(response: Response, headers: Headers): Response {
  const merged = new Headers(response.headers);
  for (const [name, value] of headers) {
    if (ENFORCED_HEADERS.has(name) || !merged.has(name)) merged.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  });
}
