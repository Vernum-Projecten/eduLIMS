// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";
import { refuseFormBody } from "@/server/form-body-limit";
import { refuseJsonBody } from "@/server/json-body-limit";
import { inputRefusalLogMiddleware } from "@/server/middleware";
import { refuseRouteBody } from "@/server/route-body-limit";
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

/** Refuses a JSON body to a server function before Start reads it, when it is too large. */
const jsonBodyLimitMiddleware = createMiddleware().server(
  async ({ next, request, handlerType }) => {
    if (handlerType !== "serverFn") return next();
    return (await refuseJsonBody(request)) ?? next();
  },
);

/** Refuses a form sent to a server function before its body is read, when it is too large. */
const formBodyLimitMiddleware = createMiddleware().server(({ next, request, handlerType }) => {
  if (handlerType !== "serverFn") return next();
  return refuseFormBody(request) ?? next();
});

/** Refuses a body to a server route or page before the route reads it, when it is too large. */
const routeBodyLimitMiddleware = createMiddleware().server(
  async ({ next, request, pathname, handlerType }) => {
    if (handlerType === "serverFn") return next();
    return (await refuseRouteBody(request, pathname)) ?? next();
  },
);

export const startInstance = createStart(() => ({
  requestMiddleware: [
    securityHeadersMiddleware,
    csrfMiddleware,
    jsonBodyLimitMiddleware,
    formBodyLimitMiddleware,
    routeBodyLimitMiddleware,
  ],
  // Global function middleware runs first in every server function's chain, around its validator.
  functionMiddleware: [inputRefusalLogMiddleware],
}));
