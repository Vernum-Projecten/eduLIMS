// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { createFileRoute } from "@tanstack/react-router";
import { getAuth } from "@/server/auth";

const handle = ({ request }: { request: Request }) => getAuth().handler(request);

/**
 * better-auth endpoints: sign-in, the OAuth and SAML callbacks, sign-out, the session, and SCIM
 * (#45, #365). Each method better-auth registers has its own handler, so none falls through to
 * the page renderer; `src/server/auth-route-methods.test.ts` checks the list against better-auth.
 */
// NOTE: ASVS V4.1.4; explicit methods, not `ANY`, so a method no endpoint serves stays unrouted.
export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
      PUT: handle,
      PATCH: handle,
      DELETE: handle,
    },
  },
});
