// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The body limits of the server routes on the built server (ASVS 5.0 V5.2.1, V15.2.2, #350): per
// route family a body at the limit reaches the route, one byte over is 413, a chunked body over
// the limit is cut off, and a lying length is refused or bounded, each refusal closing the socket.
import { expect, test } from "@playwright/test";
import {
  AUTH_BODY_MAX,
  type RouteBodyFamily,
  SAML_BODY_MAX,
  SCIM_BODY_MAX,
} from "../../src/server/route-body-limit";
import { rawChunkedPost, rawPost } from "./raw-http";
import { appUrl } from "./run-env";

interface Family {
  readonly family: RouteBodyFamily;
  readonly path: string;
  readonly limit: number;
  readonly type: string;
}

const FAMILIES: readonly Family[] = [
  {
    family: "auth",
    path: "/api/auth/sign-out",
    limit: AUTH_BODY_MAX,
    type: "application/json",
  },
  {
    family: "saml",
    path: "/api/auth/sso/saml2/sp/acs/keycloak-saml",
    limit: SAML_BODY_MAX,
    type: "application/x-www-form-urlencoded",
  },
  {
    family: "scim",
    path: "/api/auth/scim/v2/Users",
    limit: SCIM_BODY_MAX,
    type: "application/scim+json",
  },
  { family: "none", path: "/api/health", limit: 0, type: "text/plain" },
];

const STATUS_413 = /^HTTP\/1\.1 413\b/;
const CLOSE = /\r\nconnection: close\r\n/i;

for (const { family, path, limit, type } of FAMILIES) {
  test.describe(`the ${family} routes`, () => {
    test("let a body of exactly the limit reach the route (V5.2.1)", async ({ request }) => {
      const response = await request.post(path, {
        headers: { Origin: appUrl(), "Content-Type": type },
        data: Buffer.alloc(limit, 0x20),
      });
      expect([411, 413]).not.toContain(response.status());
    });

    test("refuse a body one byte over the limit with 413 and close (V5.2.1)", async () => {
      const result = await rawPost(path, { "Content-Type": type }, limit + 1);
      expect(result.status).toMatch(STATUS_413);
      expect(result.answer).toMatch(CLOSE);
    });

    test("refuse a chunked body one byte over the limit with 413 and close (V5.2.1)", async () => {
      const result = await rawChunkedPost(path, { "Content-Type": type }, limit + 1);
      expect(result.status).toMatch(STATUS_413);
      expect(result.answer).toMatch(CLOSE);
    });

    test("cut off a chunked body that goes on past the limit (V15.2.2)", async () => {
      const size = limit + 8 * 1024 * 1024;
      const result = await rawChunkedPost(path, { "Content-Type": type }, size);
      // The socket closes with the rest unread, so TCP may reset it before the 413 is read.
      expect(result.closedEarly).toBe(true);
      expect(result.written).toBeLessThan(size);
      if (result.status !== "") expect(result.status).toMatch(STATUS_413);
    });

    test("refuse a length declared far over the body it sends, unread (V15.2.2)", async () => {
      const declared = 100 * 1024 * 1024;
      const result = await rawPost(path, { "Content-Type": type }, declared, limit + 1);
      expect(result.status).toMatch(STATUS_413);
      expect(result.answer).toMatch(CLOSE);
    });
  });
}

test("reads no more than a declared length that is shorter than the body (V5.2.1)", async () => {
  // Node takes the declared byte as the body; the rest is no valid request and closes the socket.
  const result = await rawPost("/api/health", { "Content-Type": "text/plain" }, 1, 4 * 1024 * 1024);
  expect(result.status).toMatch(STATUS_413);
  expect(result.closedEarly).toBe(true);
});

test("answers a SCIM refusal as a SCIM error (RFC 7644 §3.12)", async ({ request }) => {
  const response = await request.post("/api/auth/scim/v2/Users", {
    headers: { Origin: appUrl(), "Content-Type": "application/scim+json" },
    data: Buffer.alloc(SCIM_BODY_MAX + 1, 0x20),
  });
  expect(response.status()).toBe(413);
  expect(response.headers()["content-type"]).toBe("application/scim+json");
  expect(await response.json()).toEqual(expect.objectContaining({ status: "413" }));
});
