// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";
import { formBodyLimit, refuseFormBody } from "@/server/form-body-limit";
import { refuseJsonBody } from "@/server/json-body-limit";
import { inputRefusalLogMiddleware } from "@/server/middleware";
import { refuseRouteBody } from "@/server/route-body-limit";
import { createNonce, securityHeaders, withSecurityHeaders } from "@/server/security-headers";
import { uploadGen5Fn } from "@/server/upload/functions";

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

/**
 * Refuses a form sent to a server function before its body is read, when it is too large; the
 * Gen5 upload's function has its own limit (#156).
 */
const formBodyLimitMiddleware = createMiddleware().server(({ next, request, handlerType }) => {
  if (handlerType !== "serverFn") return next();
  const limit = formBodyLimit(new URL(request.url).pathname, uploadGen5Fn.url);
  return refuseFormBody(request, limit) ?? next();
});

/** Refuses a body to a server route or page before the route reads it, when it is too large. */
const routeBodyLimitMiddleware = createMiddleware().server(
  async ({ next, request, handlerType }) => {
    if (handlerType === "serverFn") return next();
    return (await refuseRouteBody(request)) ?? next();
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
