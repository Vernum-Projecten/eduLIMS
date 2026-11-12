// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Test helpers: an openEHR client over a stubbed `fetch`, so tests stub FerroEHR and the token
// endpoint at the HTTP layer (testing.md).
import { createOpenEhrClient, type OpenEhrClient } from "./client.ts";
import type { HttpFetch } from "./token.ts";

/** The test-only configuration of {@link testOpenEhrClient}; none of it is a real credential. */
export const TEST_OPENEHR_CONFIG = {
  baseUrl: new URL("http://ferroehr.test:8080/ferroehr/rest/openehr/v1"),
  tokenUrl: new URL("http://idp.test/realms/edulims/protocol/openid-connect/token"),
  clientId: "edulims-ferroehr",
  clientSecret: "test-only-client-secret-0123456789",
  scope: "system/template-*.cr",
} as const;

/** Returns a client over `fetch`, with `baseUrl` in place of the test base URL when given. */
export function testOpenEhrClient(
  fetch: HttpFetch,
  options: { baseUrl?: string; nowMs?: () => number; timeoutMs?: number } = {},
): OpenEhrClient {
  return createOpenEhrClient(
    {
      ...TEST_OPENEHR_CONFIG,
      ...(options.baseUrl === undefined ? {} : { baseUrl: new URL(options.baseUrl) }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    },
    { fetch, nowMs: options.nowMs ?? (() => 0) },
  );
}
