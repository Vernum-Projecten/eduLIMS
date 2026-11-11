// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

/** A fresh base64 nonce for the Content-Security-Policy of one response. */
export function createNonce(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
}

/**
 * Security headers for every response. CSP and HSTS are only sent by production builds:
 * the Vite dev server injects inline scripts without a nonce and runs on plain HTTP.
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
  }
  return headers;
}

/** Copies the security headers onto a response, keeping headers the handler already set. */
export function withSecurityHeaders(response: Response, headers: Headers): Response {
  const merged = new Headers(response.headers);
  for (const [name, value] of headers) {
    if (!merged.has(name)) merged.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  });
}
