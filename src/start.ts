// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";
import { createNonce, securityHeaders, withSecurityHeaders } from "@/server/security-headers";

/** Rejects cross-site server function calls (same-origin RPC only). */
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

/** Adds CSP (with a per-request nonce), HSTS and related headers to every response. */
const securityHeadersMiddleware = createMiddleware().server(async ({ next }) => {
  const nonce = createNonce();
  const result = await next({ context: { cspNonce: nonce } });
  const headers = securityHeaders({ nonce, production: import.meta.env.PROD });
  return { ...result, response: withSecurityHeaders(result.response, headers) };
});

export const startInstance = createStart(() => ({
  requestMiddleware: [securityHeadersMiddleware, csrfMiddleware],
}));
