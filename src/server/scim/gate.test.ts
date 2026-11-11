// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The guard in front of the SCIM endpoint (#45; API4, ASVS V2.4.1, V16.3.1): the rate limit per
// token, the body cap, the error shape, and the activity-log action of each request.
import { describe, expect, it } from "vitest";
import {
  bearerOf,
  bodyTooLarge,
  rateKeyOf,
  ScimRateLimiter,
  scimErrorResponse,
  scimWriteAction,
  scimWriteEvent,
} from "./gate.ts";

describe("ScimRateLimiter", () => {
  it("allows the limit per window, then answers with the seconds to wait", () => {
    const limiter = new ScimRateLimiter({ maxRequests: 2, windowMs: 60_000 });
    expect(limiter.hit("a", 0)).toBeNull();
    expect(limiter.hit("a", 1_000)).toBeNull();
    expect(limiter.hit("a", 2_000)).toBe(58);
    expect(limiter.hit("b", 2_000)).toBeNull();
  });

  it("starts a new window once the old one ends", () => {
    const limiter = new ScimRateLimiter({ maxRequests: 1, windowMs: 1_000 });
    expect(limiter.hit("a", 0)).toBeNull();
    expect(limiter.hit("a", 500)).toBe(1);
    expect(limiter.hit("a", 1_000)).toBeNull();
  });
});

describe("rateKeyOf", () => {
  it("keys a token by its digest, never the token, and requests without one together", () => {
    const token = new Headers({ authorization: "Bearer edulims_scim_secret" });
    expect(bearerOf(token)).toBe("edulims_scim_secret");
    expect(rateKeyOf(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(rateKeyOf(token)).not.toContain("secret");
    expect(rateKeyOf(new Headers())).toBe("anonymous");
    expect(bearerOf(new Headers({ authorization: "Basic abc" }))).toBeNull();
  });
});

describe("bodyTooLarge", () => {
  it("refuses a declared length over the cap without reading", async () => {
    const request = new Request("http://x/scim/v2/Users", {
      method: "POST",
      headers: { "content-length": "2000" },
      body: "{}",
    });
    expect(await bodyTooLarge(request, 1_000)).toBe(true);
  });

  it("refuses a body over the cap, and leaves one under it readable", async () => {
    const big = new Request("http://x", { method: "POST", body: "x".repeat(2_000) });
    expect(await bodyTooLarge(big, 1_000)).toBe(true);
    const small = new Request("http://x", { method: "POST", body: "x".repeat(10) });
    expect(await bodyTooLarge(small, 1_000)).toBe(false);
    expect(await small.text()).toBe("x".repeat(10));
    expect(await bodyTooLarge(new Request("http://x"), 1_000)).toBe(false);
  });
});

describe("scimErrorResponse", () => {
  it("answers in the SCIM error format with only a status and a fixed detail", async () => {
    const response = scimErrorResponse(429, "Too many requests", { "retry-after": "5" });
    expect(response.status).toBe(429);
    expect(response.headers.get("content-type")).toBe("application/scim+json");
    expect(response.headers.get("retry-after")).toBe("5");
    expect(await response.json()).toEqual({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "429",
      detail: "Too many requests",
    });
  });
});

describe("scimWriteAction", () => {
  it.each([
    ["POST", "/scim/v2/Users", "scim_user_created"],
    ["PATCH", "/scim/v2/Users/:userId", "scim_user_updated"],
    ["PUT", "/scim/v2/Users/:userId", "scim_user_updated"],
    ["DELETE", "/scim/v2/Users/:userId", "scim_user_deleted"],
    ["POST", "/scim/v2/Groups", "scim_group_created"],
    ["PATCH", "/scim/v2/Groups/:groupId", "scim_group_updated"],
    ["DELETE", "/scim/v2/Groups/:groupId", "scim_group_deleted"],
  ])("%s %s is %s", (method, path, action) => {
    expect(scimWriteAction(method, path)).toBe(action);
  });

  it("logs no read and nothing outside Users and Groups", () => {
    expect(scimWriteAction("GET", "/scim/v2/Users")).toBeNull();
    expect(scimWriteAction("POST", "/scim/v2/Bulk")).toBeNull();
  });
});

describe("scimWriteEvent", () => {
  it("targets the SCIM resource of the action's kind", () => {
    const base = { actor: { type: "system" as const }, outcome: "success" as const };
    expect(scimWriteEvent("scim_user_created", base, "u1")).toMatchObject({
      target: { type: "scim_user", id: "u1" },
    });
    expect(scimWriteEvent("scim_group_deleted", base, "g1")).toMatchObject({
      target: { type: "scim_group", id: "g1" },
    });
    expect(scimWriteEvent("scim_group_deleted", base, undefined)).not.toHaveProperty("target");
  });
});
