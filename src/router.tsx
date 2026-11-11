// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { getGlobalStartContext } from "@tanstack/react-start";
import { DEFAULT_STALE_TIME, QUERY_RETRY } from "./lib/query-config";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  // One QueryClient per request on the server, so no user's data reaches another request.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: DEFAULT_STALE_TIME, retry: QUERY_RETRY } },
  });
  // Per-request CSP nonce from the security headers middleware (undefined on the client).
  const nonce = getGlobalStartContext()?.cspNonce;
  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    // The Query cache decides freshness, not the router's own preload cache.
    defaultPreloadStaleTime: 0,
    ...(nonce ? { ssr: { nonce } } : {}),
  });
  setupRouterSsrQueryIntegration({ router, queryClient });
  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
