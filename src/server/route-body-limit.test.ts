// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The size limit of a body sent to a server route (ASVS 5.0 V5.2.1, V15.2.2, #350): per route
// family a body at the limit, one byte over, a chunked body without a length, and a streamed body
// that lies about its length, cut off at the limit without being read whole.
import { describe, expect, it } from "vitest";
import {
  AUTH_BODY_MAX,
  type RouteBodyFamily,
  refuseRouteBody,
  routeBodyFamily,
  routeBodyLimit,
  routeBodyRefusal,
  SAML_BODY_MAX,
  SCIM_BODY_MAX,
} from "./route-body-limit.ts";
import { setSecurityLogWriter } from "./security-log.ts";

const ORIGIN = "http://edulims.test";

const PATHS: Readonly<Record<RouteBodyFamily, string>> = {
  auth: "/api/auth/sign-in/sso",
  saml: "/api/auth/sso/saml2/sp/acs/keycloak-saml",
  scim: "/api/auth/scim/v2/Groups/g-1",
  none: "/api/health",
};

const FAMILIES: readonly RouteBodyFamily[] = ["auth", "saml", "scim", "none"];

/** A POST to `path` of `size` bytes, with `declared` as its `Content-Length`, or none. */
function post(path: string, size: number, declared: number | null = size): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: declared === null ? {} : { "content-length": String(declared) },
    body: "a".repeat(size),
  });
}

/** A stream of `chunk`-byte chunks without end that counts the bytes it hands out. */
function endlessStream(chunk: number) {
  const state = { pulled: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        state.pulled += chunk;
        controller.enqueue(new Uint8Array(chunk).fill(0x61));
      },
      cancel() {
        state.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, state };
}

function streamedPost(path: string, stream: ReadableStream<Uint8Array>, headers = {}): Request {
  // NOTE: Fetch standard, RequestInit `duplex`; a stream body needs it, and the DOM types lack it.
  const init: RequestInit & { duplex: "half" } = {
    method: "POST",
    headers,
    body: stream,
    duplex: "half",
  };
  return new Request(`${ORIGIN}${path}`, init);
}

describe("routeBodyFamily", () => {
  it("sorts the better-auth paths into SAML, SCIM and the rest", () => {
    expect(routeBodyFamily("/api/auth/sso/saml2/sp/acs/p")).toBe("saml");
    expect(routeBodyFamily("/api/auth/sso/saml2/sp/slo/p")).toBe("saml");
    expect(routeBodyFamily("/api/auth/scim/v2")).toBe("scim");
    expect(routeBodyFamily("/api/auth/scim/v2/Users/u")).toBe("scim");
    expect(routeBodyFamily("/api/auth/sign-in/sso")).toBe("auth");
    expect(routeBodyFamily("/api/auth/sso/callback/p")).toBe("auth");
    expect(routeBodyFamily("/api/auth/scim/v2x")).toBe("auth");
  });

  it("gives every other route, a page included, no body at all", () => {
    for (const path of ["/api/health", "/api/ready", "/api/labs/l/logo", "/", "/api/auth"]) {
      expect(routeBodyFamily(path)).toBe("none");
    }
    expect(routeBodyLimit("none")).toBe(0);
  });
});

describe.each(FAMILIES)("routeBodyRefusal for the %s family", (family) => {
  const path = PATHS[family];
  const limit = routeBodyLimit(family);

  it("lets a body of exactly the limit through, and the route can still read it", async () => {
    const request = post(path, limit);
    expect(await routeBodyRefusal(request, limit)).toBeNull();
    expect(await request.text()).toHaveLength(limit);
  });

  it("refuses a declared length one byte over the limit with 413", async () => {
    expect(await routeBodyRefusal(post(path, 1, limit + 1), limit)).toBe(413);
  });

  it("refuses a body one byte over the limit with 413", async () => {
    expect(await routeBodyRefusal(post(path, limit + 1), limit)).toBe(413);
  });

  it("counts a chunked body: at the limit it passes, one byte over it is refused", async () => {
    const at = post(path, limit, null);
    expect(await routeBodyRefusal(at, limit)).toBeNull();
    expect(await at.text()).toHaveLength(limit);
    expect(await routeBodyRefusal(post(path, limit + 1, null), limit)).toBe(413);
  });

  it("cuts off a chunked body without end at the limit", async () => {
    const { stream, state } = endlessStream(4096);
    expect(await routeBodyRefusal(streamedPost(path, stream), limit)).toBe(413);
    expect(state.cancelled).toBe(true);
    expect(state.pulled).toBeLessThanOrEqual(limit + 3 * 4096);
  });

  it("cuts off a body that streams past the limit under a smaller declared length", async () => {
    const { stream, state } = endlessStream(4096);
    const lying = streamedPost(path, stream, { "content-length": "0" });
    expect(await routeBodyRefusal(lying, limit)).toBe(413);
    expect(state.cancelled).toBe(true);
    expect(state.pulled).toBeLessThanOrEqual(limit + 3 * 4096);
  });
});

describe("routeBodyRefusal", () => {
  it("refuses a chunked body over the limit while another clone stays unread (#350)", async () => {
    // The locale middleware clones every request and never reads its copy.
    const { stream } = endlessStream(4096);
    const request = streamedPost(PATHS.auth, stream);
    const unread = request.clone();
    expect(unread.bodyUsed).toBe(false);
    expect(await routeBodyRefusal(request, AUTH_BODY_MAX)).toBe(413);
  });

  it("refuses a malformed declared length with 411", async () => {
    for (const declared of ["-1", "1e3", "12 34", "0x10", "9".repeat(16)]) {
      const request = new Request(`${ORIGIN}/api/auth/sign-out`, {
        method: "POST",
        headers: { "content-length": declared },
        body: "{}",
      });
      expect(await routeBodyRefusal(request, AUTH_BODY_MAX)).toBe(411);
    }
  });

  it("lets a GET without a body through", async () => {
    expect(await routeBodyRefusal(new Request(`${ORIGIN}/api/health`), 0)).toBeNull();
  });

  it("holds the limits the PR states", () => {
    expect(AUTH_BODY_MAX).toBe(64 * 1024);
    expect(SAML_BODY_MAX).toBe(128 * 1024);
    expect(SCIM_BODY_MAX).toBe(1024 * 1024);
  });

  it("holds the largest SCIM body the plugin takes, a Group of its 1,000 members", async () => {
    const id = "0193a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b";
    const group = JSON.stringify({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
      externalId: "x".repeat(255),
      displayName: "x".repeat(256),
      members: Array.from({ length: 1000 }, () => ({
        value: id,
        type: "User",
        display: "x".repeat(256),
        $ref: `https://idp.example.test/scim/v2/Users/${id}`,
      })),
    });
    const request = new Request(`${ORIGIN}${PATHS.scim}`, { method: "PUT", body: group });
    expect(await routeBodyRefusal(request, SCIM_BODY_MAX)).toBeNull();
  });
});

describe("refuseRouteBody", () => {
  function capture(): { lines: string[]; restore: () => void } {
    const lines: string[] = [];
    return { lines, restore: setSecurityLogWriter((line) => lines.push(line)) };
  }

  it("answers 413 empty with Connection: close and logs codes and ids only", async () => {
    const { lines, restore } = capture();
    try {
      const response = await refuseRouteBody(post(PATHS.saml, SAML_BODY_MAX + 1, null), PATHS.saml);
      expect(response?.status).toBe(413);
      expect(response?.headers.get("connection")).toBe("close");
      expect(response?.headers.get("cache-control")).toBe("no-store");
      expect(await response?.text()).toBe("");
    } finally {
      restore();
    }
    const parsed: unknown[] = lines.map((line): unknown => JSON.parse(line));
    expect(parsed).toEqual([
      expect.objectContaining({
        event: "input_validation_fail",
        outcome: "refused",
        reason: "route_body_too_large",
        kind: "saml",
        status: 413,
      }),
    ]);
  });

  it("logs the request id the reverse proxy set, and leaves out a malformed one", async () => {
    const { lines, restore } = capture();
    try {
      for (const id of ["req-350", "not an id"]) {
        const request = new Request(`${ORIGIN}/api/health`, {
          method: "POST",
          headers: { "content-length": "1", "x-request-id": id },
          body: "a",
        });
        await refuseRouteBody(request, "/api/health");
      }
    } finally {
      restore();
    }
    const parsed: unknown[] = lines.map((line): unknown => JSON.parse(line));
    expect(parsed).toEqual([
      expect.objectContaining({ request_id: "req-350", kind: "none" }),
      expect.not.objectContaining({ request_id: expect.anything() as unknown }),
    ]);
  });

  it("answers a SCIM refusal as a SCIM error that closes the connection (RFC 7644 §3.12)", async () => {
    const { restore } = capture();
    try {
      const response = await refuseRouteBody(post(PATHS.scim, 1, SCIM_BODY_MAX + 1), PATHS.scim);
      expect(response?.status).toBe(413);
      expect(response?.headers.get("connection")).toBe("close");
      expect(response?.headers.get("content-type")).toBe("application/scim+json");
      expect(await response?.json()).toEqual({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        status: "413",
        detail: "Request body too large",
      });
      const malformed = new Request(`${ORIGIN}${PATHS.scim}`, {
        method: "POST",
        headers: { "content-length": "x" },
        body: "{}",
      });
      const length = await refuseRouteBody(malformed, PATHS.scim);
      expect(length?.status).toBe(411);
      expect(await length?.json()).toEqual(expect.objectContaining({ status: "411" }));
    } finally {
      restore();
    }
  });

  it("lets a body within the limit through without a log line", async () => {
    const { lines, restore } = capture();
    try {
      expect(await refuseRouteBody(post(PATHS.auth, 100), PATHS.auth)).toBeNull();
    } finally {
      restore();
    }
    expect(lines).toEqual([]);
  });
});
