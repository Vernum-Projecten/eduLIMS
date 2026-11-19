// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The join context of a request (#288, ASVS V2.4.1): the client IP only through the trusted
// proxies, the key under the server's better-auth secret, and the server's limits.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VALID_ENV } from "../test-env.ts";
import { joinCodeKey } from "./join-code.ts";
import { JOIN_LIMITS } from "./join-limits.ts";

const request = vi.hoisted(() => ({ headers: new Headers() }));
const env = vi.hoisted(() => ({ trusted: "" }));

vi.mock("@tanstack/react-start/server", () => ({ getRequestHeaders: () => request.headers }));
vi.mock("../env.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../env.ts")>();
  return {
    ...actual,
    getEnv: () => actual.parseEnv({ ...VALID_ENV, EDULIMS_TRUSTED_PROXIES: env.trusted }),
  };
});

const { requestJoinContext, serverJoinCodeKey } = await import("./join-context.ts");

const NOW = new Date("2026-11-19T09:00:00Z");

beforeEach(() => {
  request.headers = new Headers({ "x-forwarded-for": "198.51.100.7" });
  env.trusted = "";
});

describe("requestJoinContext (#288)", () => {
  it("has no client IP when no proxy is trusted, so only the per-student limit applies", () => {
    expect(requestJoinContext(NOW)).toEqual({
      now: NOW,
      clientIp: null,
      key: serverJoinCodeKey(),
      limits: JOIN_LIMITS,
    });
  });

  it("takes the client IP from the forwarded chain past a trusted proxy", () => {
    env.trusted = "10.0.0.0/8";
    request.headers = new Headers({ "x-forwarded-for": "198.51.100.7, 10.0.0.1" });
    expect(requestJoinContext(NOW).clientIp).toBe("198.51.100.7");
  });

  it("never takes an address a client put in front of an untrusted hop", () => {
    env.trusted = "10.0.0.0/8";
    request.headers = new Headers({ "x-forwarded-for": "198.51.100.7, 203.0.113.9" });
    expect(requestJoinContext(NOW).clientIp).toBe("203.0.113.9");
  });
});

describe("serverJoinCodeKey (#288)", () => {
  it("is the key under the server's better-auth secret, made once", () => {
    const key = serverJoinCodeKey();
    expect(key.fingerprint).toBe(joinCodeKey(VALID_ENV.BETTER_AUTH_SECRET).fingerprint);
    expect(serverJoinCodeKey()).toBe(key);
  });
});
