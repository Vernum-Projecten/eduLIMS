// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The size limit of a body sent to a server route (ASVS 5.0 V5.2.1, V15.2.2, #350): per route
// family a body at the limit, one byte over, a chunked body, and a streamed body that lies about
// its length, cut off at the limit without being read whole; a SCIM body checked on its declared
// length only, and counted by the SCIM gate after its rate limit.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "./db/schema.gen.ts";
import { createTestDb } from "./db/test-db.ts";
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
import { scimGate } from "./scim/gate.ts";
import { SCIM_LIMITS } from "./scim/limits.ts";
import { setSecurityLogWriter } from "./security-log.ts";

const ORIGIN = "http://edulims.test";

const PATHS: Readonly<Record<RouteBodyFamily, string>> = {
  auth: "/api/auth/sign-in/sso",
  saml: "/api/auth/sso/saml2/sp/acs/keycloak-saml",
  scim: "/api/auth/scim/v2/Groups/g-1",
  none: "/api/health",
};

/** The families whose body the middleware counts as it streams. */
const COUNTED: readonly RouteBodyFamily[] = ["auth", "saml", "none"];
const FAMILIES: readonly RouteBodyFamily[] = [...COUNTED, "scim"];

const CHUNKED = { "transfer-encoding": "chunked" } as const;

/** A POST to `path` of `size` bytes, with `declared` as its `Content-Length`, or chunked. */
function post(path: string, size: number, declared: number | null = size): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: declared === null ? CHUNKED : { "content-length": String(declared) },
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

function streamedPost(
  path: string,
  stream: ReadableStream<Uint8Array>,
  headers: Record<string, string> = CHUNKED,
): Request {
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

  it("reads a prefix spelled with escapes as the smaller auth family (S2)", () => {
    for (const path of ["/api/auth/s%73o/saml2/sp/acs/x", "/api/auth/sc%69m/v2/Users"]) {
      expect(routeBodyFamily(new URL(`${ORIGIN}${path}`).pathname)).toBe("auth");
    }
  });
});

describe.each(FAMILIES)("routeBodyRefusal for the %s family", (family) => {
  const path = PATHS[family];
  const limit = routeBodyLimit(family);

  it("lets a body of exactly the limit through, and the route can still read it", async () => {
    const request = post(path, limit);
    expect(await routeBodyRefusal(request, family)).toBeNull();
    expect(await request.text()).toHaveLength(limit);
  });

  it("refuses a declared length one byte over the limit with 413", async () => {
    expect(await routeBodyRefusal(post(path, 1, limit + 1), family)).toBe(413);
  });

  it("refuses a malformed declared length with 411", async () => {
    for (const declared of ["-1", "1e3", "12 34", "0x10", "9".repeat(16)]) {
      const request = new Request(`${ORIGIN}${path}`, {
        method: "POST",
        headers: { "content-length": declared },
        body: "{}",
      });
      expect(await routeBodyRefusal(request, family)).toBe(411);
    }
  });

  it("refuses a chunked GET or HEAD with 413 (S5)", async () => {
    for (const method of ["GET", "HEAD"]) {
      const request = new Request(`${ORIGIN}${path}`, { method, headers: CHUNKED });
      expect(await routeBodyRefusal(request, family)).toBe(413);
    }
  });

  it("lets a GET without a body through", async () => {
    expect(await routeBodyRefusal(new Request(`${ORIGIN}${path}`), family)).toBeNull();
  });
});

describe.each(["auth", "saml"] as const)("the counted %s family", (family) => {
  const path = PATHS[family];
  const limit = routeBodyLimit(family);

  it("refuses a body one byte over the limit with 413", async () => {
    expect(await routeBodyRefusal(post(path, limit + 1), family)).toBe(413);
  });

  it("counts a chunked body: at the limit it passes, one byte over it is refused", async () => {
    const at = post(path, limit, null);
    expect(await routeBodyRefusal(at, family)).toBeNull();
    expect(await at.text()).toHaveLength(limit);
    expect(await routeBodyRefusal(post(path, limit + 1, null), family)).toBe(413);
  });

  it("cuts off a chunked body without end at the limit", async () => {
    const { stream, state } = endlessStream(4096);
    expect(await routeBodyRefusal(streamedPost(path, stream), family)).toBe(413);
    expect(state.cancelled).toBe(true);
    expect(state.pulled).toBeLessThanOrEqual(limit + 3 * 4096);
  });

  it("cuts off a body that streams past the limit under a smaller declared length", async () => {
    const { stream, state } = endlessStream(4096);
    const lying = streamedPost(path, stream, { "content-length": "0" });
    expect(await routeBodyRefusal(lying, family)).toBe(413);
    expect(state.cancelled).toBe(true);
    expect(state.pulled).toBeLessThanOrEqual(limit + 3 * 4096);
  });

  it("refuses a chunked body over the limit while another clone stays unread", async () => {
    // The locale middleware clones every request and never reads its copy.
    const { stream } = endlessStream(4096);
    const request = streamedPost(path, stream);
    const unread = request.clone();
    expect(unread.bodyUsed).toBe(false);
    expect(await routeBodyRefusal(request, family)).toBe(413);
  });

  it("rejects, never lets through, a body whose stream fails while it is read", async () => {
    const failing = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("socket reset"));
      },
    });
    await expect(routeBodyRefusal(streamedPost(path, failing), family)).rejects.toThrow(
      "socket reset",
    );
  });
});

describe("the none family", () => {
  it("refuses a chunked body at once, without reading it (S4)", async () => {
    const { stream, state } = endlessStream(4096);
    expect(await routeBodyRefusal(streamedPost(PATHS.none, stream), "none")).toBe(413);
    expect(state.pulled).toBe(0);
  });

  it("refuses a body that streams past a declared length of 0", async () => {
    const { stream, state } = endlessStream(4096);
    const lying = streamedPost(PATHS.none, stream, { "content-length": "0" });
    expect(await routeBodyRefusal(lying, "none")).toBe(413);
    expect(state.cancelled).toBe(true);
  });

  it("lets a POST with a declared length of 0 through", async () => {
    expect(await routeBodyRefusal(post(PATHS.none, 0), "none")).toBeNull();
  });
});

describe("the scim family (S1)", () => {
  it("leaves a chunked body unread for the SCIM gate", async () => {
    const { stream, state } = endlessStream(4096);
    expect(await routeBodyRefusal(streamedPost(PATHS.scim, stream), "scim")).toBeNull();
    expect(state.pulled).toBe(0);
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
    expect(Buffer.byteLength(group)).toBeLessThan(SCIM_BODY_MAX);
    const request = new Request(`${ORIGIN}${PATHS.scim}`, {
      method: "PUT",
      headers: { "content-length": String(Buffer.byteLength(group)) },
      body: group,
    });
    expect(await routeBodyRefusal(request, "scim")).toBeNull();
  });

  describe("tokenless chunked POSTs through the middleware and the gate", () => {
    let db: Kysely<DB> | undefined;
    afterEach(async () => {
      await db?.destroy();
      db = undefined;
    });

    it("get 429 once the bucket is spent, without a byte of their body read", async () => {
      db = await createTestDb();
      const gate = scimGate(
        db,
        { ok: true },
        {
          trustedProxies: [],
          limits: { ...SCIM_LIMITS, maxRequests: 2 },
        },
      );
      const statuses: number[] = [];
      const pulled: number[] = [];
      for (let i = 0; i < 4; i += 1) {
        const { stream, state } = endlessStream(4096);
        const request = streamedPost("/api/auth/scim/v2/Users", stream);
        expect(await refuseRouteBody(request)).toBeNull();
        const answer = await gate.onRequest(request);
        statuses.push(answer?.response.status ?? 0);
        pulled.push(state.pulled);
      }
      // The first two spend the bucket and are counted by the gate, cut off at its cap.
      expect(statuses).toEqual([413, 413, 429, 429]);
      expect(pulled.slice(2)).toEqual([0, 0]);
    });
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
      const response = await refuseRouteBody(post(PATHS.saml, SAML_BODY_MAX + 1, null));
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
        refused_count: 1,
      }),
    ]);
  });

  it("logs a malformed length as route_length_invalid with 411", async () => {
    const { lines, restore } = capture();
    try {
      const request = new Request(`${ORIGIN}${PATHS.auth}`, {
        method: "POST",
        headers: { "content-length": "1e3", "x-request-id": "req-350" },
        body: "{}",
      });
      const response = await refuseRouteBody(request);
      expect(response?.status).toBe(411);
      expect(response?.headers.get("connection")).toBe("close");
    } finally {
      restore();
    }
    const parsed: unknown[] = lines.map((line): unknown => JSON.parse(line));
    expect(parsed).toEqual([
      expect.objectContaining({
        event: "input_validation_fail",
        reason: "route_length_invalid",
        kind: "auth",
        status: 411,
        request_id: "req-350",
      }),
    ]);
  });

  it("classifies on the raw path of the request URL (S2)", async () => {
    const { restore } = capture();
    try {
      // 100 KiB passes the SAML limit but not the auth limit the escaped path falls to.
      const request = post("/api/auth/s%73o/saml2/sp/acs/x", 100 * 1024);
      expect((await refuseRouteBody(request))?.status).toBe(413);
    } finally {
      restore();
    }
  });

  it("answers a SCIM refusal as a SCIM error that closes the connection (RFC 7644 §3.12)", async () => {
    const { restore } = capture();
    try {
      const response = await refuseRouteBody(post(PATHS.scim, 1, SCIM_BODY_MAX + 1));
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
      const length = await refuseRouteBody(malformed);
      expect(length?.status).toBe(411);
      expect(await length?.json()).toEqual(expect.objectContaining({ status: "411" }));
    } finally {
      restore();
    }
  });

  it("lets a body within the limit through without a log line", async () => {
    const { lines, restore } = capture();
    try {
      expect(await refuseRouteBody(post(PATHS.auth, 100))).toBeNull();
    } finally {
      restore();
    }
    expect(lines).toEqual([]);
  });

  it("holds the limits the PR states", () => {
    expect(AUTH_BODY_MAX).toBe(64 * 1024);
    expect(SAML_BODY_MAX).toBe(128 * 1024);
    expect(SCIM_BODY_MAX).toBe(1024 * 1024);
  });
});
