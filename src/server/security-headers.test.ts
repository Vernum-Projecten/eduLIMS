// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { createNonce, securityHeaders, withSecurityHeaders } from "./security-headers.ts";

describe("createNonce", () => {
  it("returns a fresh base64 value of 128 bits", () => {
    const nonce = createNonce();
    expect(Buffer.from(nonce, "base64")).toHaveLength(16);
    expect(createNonce()).not.toBe(nonce);
  });
});

describe("securityHeaders", () => {
  it("sends CSP with the nonce and HSTS in production", () => {
    const headers = securityHeaders({ nonce: "abc", production: true });
    const csp = headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("script-src 'self' 'nonce-abc'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-eval");
    expect(headers.get("Strict-Transport-Security")).toMatch(/max-age=\d+/);
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("forbids caching any response in production (#41, ASVS V14.3.2)", () => {
    const headers = securityHeaders({ nonce: "abc", production: true });
    expect(headers.get("Cache-Control")).toBe("no-store");
  });

  it("omits CSP, HSTS and the cache rule outside production", () => {
    const headers = securityHeaders({ nonce: "abc", production: false });
    expect(headers.has("Cache-Control")).toBe(false);
    expect(headers.has("Content-Security-Policy")).toBe(false);
    expect(headers.has("Strict-Transport-Security")).toBe(false);
    expect(headers.get("X-Frame-Options")).toBe("DENY");
  });
});

describe("withSecurityHeaders", () => {
  it("adds headers without overriding ones the handler set, keeping status and cookies", async () => {
    const original = new Response("body", {
      status: 201,
      headers: [
        ["X-Frame-Options", "SAMEORIGIN"],
        ["Set-Cookie", "a=1"],
        ["Set-Cookie", "b=2"],
      ],
    });
    const result = withSecurityHeaders(original, securityHeaders({ nonce: "n", production: true }));
    expect(result.status).toBe(201);
    expect(result.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(result.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(result.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
    expect(await result.text()).toBe("body");
  });

  it("replaces a cache policy the handler set with no-store (#41)", () => {
    const original = new Response(null, { headers: { "Cache-Control": "public, max-age=600" } });
    const result = withSecurityHeaders(original, securityHeaders({ nonce: "n", production: true }));
    expect(result.headers.get("Cache-Control")).toBe("no-store");
  });

  it("keeps the handler's cache policy outside production", () => {
    const original = new Response(null, { headers: { "Cache-Control": "max-age=60" } });
    const result = withSecurityHeaders(
      original,
      securityHeaders({ nonce: "n", production: false }),
    );
    expect(result.headers.get("Cache-Control")).toBe("max-age=60");
  });
});
