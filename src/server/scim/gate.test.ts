// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The guard in front of the SCIM endpoint (#45; API4, ASVS V2.4.1, V6.8.1, V16.3.1): the rate
// limit and its keys, the body cap, the error shape, the e-mail addresses a body sets, the
// activity-log action of each request and the once-per-window refusal log.
import { describe, expect, it } from "vitest";
import { RefusalDeduper, scimResourceAction, scimResourceEvent } from "./audit.ts";
import { scimBodyAddresses, setsAddress, stripCoreUserUrn } from "./emails.ts";
import { scimErrorResponse } from "./gate.ts";
import { bearerOf, bodyTooLarge, rateKeyOf, ScimRateLimiter } from "./limits.ts";

describe("ScimRateLimiter", () => {
  it("allows the limit per window, then answers with the seconds to wait", () => {
    const limiter = new ScimRateLimiter({ maxRequests: 2, windowMs: 60_000, maxKeys: 10 });
    expect(limiter.hit("a", 0)).toBeNull();
    expect(limiter.hit("a", 1_000)).toBeNull();
    expect(limiter.hit("a", 2_000)).toBe(58);
    expect(limiter.hit("b", 2_000)).toBeNull();
  });

  it("starts a new window once the old one ends", () => {
    const limiter = new ScimRateLimiter({ maxRequests: 1, windowMs: 1_000, maxKeys: 10 });
    expect(limiter.hit("a", 0)).toBeNull();
    expect(limiter.hit("a", 500)).toBe(1);
    expect(limiter.hit("a", 1_000)).toBeNull();
  });

  it("refuses a new key while every slot holds a live window, and frees ended ones (H3)", () => {
    const limiter = new ScimRateLimiter({ maxRequests: 5, windowMs: 1_000, maxKeys: 2 });
    expect(limiter.hit("a", 0)).toBeNull();
    expect(limiter.hit("b", 0)).toBeNull();
    expect(limiter.hit("c", 100)).toBe(1);
    expect(limiter.hit("a", 200)).toBeNull();
    expect(limiter.hit("c", 1_000)).toBeNull();
  });
});

describe("provider buckets apart from client buckets (second review, finding 1)", () => {
  it("lets a provider through a table full of client keys, live or ended", () => {
    const limiter = new ScimRateLimiter({ maxRequests: 5, windowMs: 1_000, maxKeys: 3 });
    for (const ip of ["a", "b", "c"]) expect(limiter.hit(`ip:${ip}`, 0)).toBeNull();
    expect(limiter.hit("ip:d", 10)).toBe(1);
    expect(limiter.hit("provider:x", 10)).toBeNull();
    expect(limiter.hit("provider:x", 2_000)).toBeNull();
  });

  it("checks a client bucket without counting a request", () => {
    const limiter = new ScimRateLimiter({ maxRequests: 1, windowMs: 1_000, maxKeys: 3 });
    expect(limiter.wait("ip:a", 0)).toBeNull();
    expect(limiter.wait("ip:a", 0)).toBeNull();
    expect(limiter.hit("ip:a", 0)).toBeNull();
    expect(limiter.wait("ip:a", 10)).toBe(1);
  });
});

describe("rate-limit keys (H3)", () => {
  it("keys a working token by its provider and everything else by the client IP", () => {
    expect(rateKeyOf("campus", "192.0.2.10")).toBe("provider:campus");
    expect(rateKeyOf(null, "192.0.2.10")).toBe("ip:192.0.2.10");
    expect(rateKeyOf(null, null)).toBe("ip:unknown");
  });

  it("reads only a bearer token", () => {
    expect(bearerOf(new Headers({ authorization: "Bearer edulims_scim_x" }))).toBe(
      "edulims_scim_x",
    );
    expect(bearerOf(new Headers({ authorization: "Basic abc" }))).toBeNull();
    expect(bearerOf(new Headers())).toBeNull();
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
  it("answers in the SCIM error format with only a status, a fixed detail and a type", async () => {
    const response = scimErrorResponse(409, "taken", {}, "uniqueness");
    expect(response.headers.get("content-type")).toBe("application/scim+json");
    expect(await response.json()).toEqual({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "409",
      scimType: "uniqueness",
      detail: "taken",
    });
    const limited = scimErrorResponse(429, "Too many requests", { "retry-after": "5" });
    expect(limited.headers.get("retry-after")).toBe("5");
  });
});

describe("scimBodyAddresses (H1)", () => {
  it("collects userName and every email of a create or replace, lower case, once", () => {
    expect(
      scimBodyAddresses({
        userName: "S.Visser@example.test",
        emails: [{ value: "s.visser@example.test" }, { value: "home@example.test" }],
      }),
    ).toEqual(["s.visser@example.test", "home@example.test"]);
  });

  it("collects the values of PATCH operations on userName and emails, with or without a path", () => {
    expect(
      scimBodyAddresses({
        Operations: [
          { op: "replace", path: 'emails[type eq "work"].value', value: "a@example.test" },
          { op: "replace", path: "userName", value: "b@example.test" },
          { op: "replace", value: { emails: [{ value: "c@example.test" }] } },
          { op: "replace", path: "displayName", value: "d@example.test" },
        ],
      }),
    ).toEqual(["a@example.test", "b@example.test", "c@example.test"]);
  });

  it("ignores a userName that is not an address", () => {
    expect(scimBodyAddresses({ userName: "svisser" })).toEqual([]);
  });
});

describe("URN-qualified paths and attributes (second review, finding 6)", () => {
  it("strips the core User URN from PATCH paths, with spaces around them", () => {
    expect(
      scimBodyAddresses({
        Operations: [
          {
            op: "replace",
            path: "  urn:ietf:params:scim:schemas:core:2.0:User:userName ",
            value: "a@example.test",
          },
          {
            op: "add",
            path: 'URN:IETF:PARAMS:SCIM:SCHEMAS:CORE:2.0:USER:emails[type eq "work"].value',
            value: "b@example.test",
          },
        ],
      }),
    ).toEqual(["a@example.test", "b@example.test"]);
  });

  it("reads URN-keyed attributes of a pathless PATCH value and of a create body", () => {
    expect(
      scimBodyAddresses({
        Operations: [
          {
            op: "replace",
            value: {
              "urn:ietf:params:scim:schemas:core:2.0:User:userName": "c@example.test",
              "urn:ietf:params:scim:schemas:core:2.0:User:emails": [{ value: "d@example.test" }],
            },
          },
        ],
      }),
    ).toEqual(["c@example.test", "d@example.test"]);
    expect(
      scimBodyAddresses({
        "urn:ietf:params:scim:schemas:core:2.0:User:userName": "e@example.test",
      }),
    ).toEqual(["e@example.test"]);
  });

  it("strips only the core User URN", () => {
    expect(stripCoreUserUrn(" urn:ietf:params:scim:schemas:core:2.0:User:emails ")).toBe("emails");
    expect(stripCoreUserUrn("urn:other:userName")).toBe("urn:other:userName");
  });
});

describe("scimResourceAction", () => {
  it.each([
    ["POST", "/scim/v2/Users", "scim_user_created"],
    ["PATCH", "/scim/v2/Users/:userId", "scim_user_updated"],
    ["PUT", "/scim/v2/Users/:userId", "scim_user_updated"],
    ["DELETE", "/scim/v2/Users/:userId", "scim_user_deleted"],
    ["GET", "/scim/v2/Users/:userId", "scim_user_read"],
    ["POST", "/scim/v2/Groups", "scim_group_created"],
    ["PATCH", "/scim/v2/Groups/:groupId", "scim_group_updated"],
    ["DELETE", "/scim/v2/Groups/:groupId", "scim_group_deleted"],
    ["GET", "/scim/v2/Groups", "scim_group_read"],
  ])("%s %s is %s", (method, path, action) => {
    expect(scimResourceAction(method, path)).toBe(action);
  });

  it("has no action outside Users and Groups", () => {
    expect(scimResourceAction("GET", "/scim/v2/Schemas")).toBeNull();
    expect(scimResourceAction("OPTIONS", "/scim/v2/Users")).toBeNull();
  });

  it("targets the SCIM resource of the action's kind", () => {
    const base = { actor: { type: "system" as const }, outcome: "refused" as const };
    expect(scimResourceEvent("scim_user_read", base, "u1")).toMatchObject({
      target: { type: "scim_user", id: "u1" },
    });
    expect(scimResourceEvent("scim_group_deleted", base, undefined)).not.toHaveProperty("target");
  });
});

describe("every PATCH form that reaches the e-mail address (third review, B1)", () => {
  const URN = "urn:ietf:params:scim:schemas:core:2.0:User:";
  const forms: readonly [string, unknown][] = [
    ['path ""', { op: "replace", path: "", value: { emails: [{ value: "a@x.example" }] } }],
    ['path "  "', { op: "replace", path: "  ", value: { userName: "a@x.example" } }],
    ["pathless emails.value", { op: "replace", value: { "emails.value": "a@x.example" } }],
    [
      'pathless emails[type eq "work"].value',
      { op: "replace", value: { 'emails[type eq "work"].value': "a@x.example" } },
    ],
    [
      "pathless emails[primary eq true].value",
      { op: "replace", value: { "emails[primary eq true].value": "a@x.example" } },
    ],
    [
      'pathless URN-prefixed emails[type eq "work"].value',
      { op: "replace", value: { [`${URN}emails[type eq "work"].value`]: "a@x.example" } },
    ],
  ];

  it.each(forms)("collects the address of %s", (_name, operation) => {
    expect(scimBodyAddresses({ Operations: [operation] })).toEqual(["a@x.example"]);
  });

  it("uses the one predicate for keys and paths", () => {
    expect(setsAddress(" emails.value ")).toBe(true);
    expect(setsAddress(`${URN}userName`)).toBe(true);
    expect(setsAddress("displayName")).toBe(false);
    expect(setsAddress("emailsVerified")).toBe(false);
  });

  it("ignores pathless keys that set no address", () => {
    expect(
      scimBodyAddresses({ Operations: [{ op: "replace", value: { displayName: "a@x.example" } }] }),
    ).toEqual([]);
  });
});

describe("RefusalDeduper counts (second review, finding 3)", () => {
  it("says how many refusals the next row stands for", () => {
    const deduper = new RefusalDeduper(1_000, 10);
    expect(deduper.next("ip:x|token_unknown", 0)).toBe(1);
    expect(deduper.next("ip:x|token_unknown", 10)).toBeNull();
    expect(deduper.next("ip:x|token_unknown", 20)).toBeNull();
    expect(deduper.next("ip:x|token_unknown", 1_000)).toBe(3);
  });
});

describe("RefusalDeduper (L2)", () => {
  it("logs one refused token once per window", () => {
    const deduper = new RefusalDeduper(1_000, 10);
    expect(deduper.first("t", 0)).toBe(true);
    expect(deduper.first("t", 500)).toBe(false);
    expect(deduper.first("u", 500)).toBe(true);
    expect(deduper.first("t", 1_000)).toBe(true);
  });

  it("keeps logging when full, dropping the oldest entry", () => {
    const deduper = new RefusalDeduper(10_000, 2);
    expect(deduper.first("a", 0)).toBe(true);
    expect(deduper.first("b", 0)).toBe(true);
    expect(deduper.first("c", 1)).toBe(true);
    expect(deduper.first("a", 2)).toBe(true);
  });
});
