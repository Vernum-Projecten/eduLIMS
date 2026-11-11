// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import { envFields, getEnv, parseEnv, parseWith } from "./env.ts";
import { VALID_ENV } from "./test-env.ts";

describe("parseEnv", () => {
  it("accepts a complete environment and coerces EDULIMS_DEV_LOGIN to a boolean", () => {
    const env = parseEnv(VALID_ENV);
    expect(env.EDULIMS_DEV_LOGIN).toBe(true);
    expect(env.NODE_ENV).toBe("test");
  });

  it("defaults to production with dev login disabled", () => {
    const { NODE_ENV: _, EDULIMS_DEV_LOGIN: __, ...rest } = VALID_ENV;
    const env = parseEnv({ ...rest, BETTER_AUTH_URL: "https://edulims.example" });
    expect(env.NODE_ENV).toBe("production");
    expect(env.EDULIMS_DEV_LOGIN).toBe(false);
  });

  it("refuses http BETTER_AUTH_URL when NODE_ENV=production", () => {
    expect(() =>
      parseEnv({ ...VALID_ENV, NODE_ENV: "production", EDULIMS_DEV_LOGIN: "false" }),
    ).toThrow(/BETTER_AUTH_URL/);
  });

  it("refuses dev login when NODE_ENV=production", () => {
    const production = { NODE_ENV: "production", BETTER_AUTH_URL: "https://edulims.example" };
    expect(() => parseEnv({ ...VALID_ENV, ...production })).toThrow(
      /must not be enabled[\s\S]*EDULIMS_DEV_LOGIN/,
    );
  });

  it.each([
    ["DATABASE_URL", "mysql://localhost/edulims"],
    ["BETTER_AUTH_SECRET", "too-short"],
    ["BETTER_AUTH_URL", "not a url"],
    ["MICROSOFT_TENANT_ID", "common"],
    ["MICROSOFT_TENANT_ID", "Organizations"],
    ["FERROEHR_BASE_URL", "ftp://ferro.example"],
    ["EDULIMS_DEV_LOGIN", "maybe"],
  ])("rejects an invalid %s (%s)", (key, value) => {
    expect(() => parseEnv({ ...VALID_ENV, [key]: value })).toThrow(new RegExp(key));
  });

  it("lists every missing variable in one error", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL[\s\S]*MICROSOFT_CLIENT_SECRET/);
  });
});

describe("parseWith", () => {
  it("validates a subset without requiring unrelated variables", () => {
    const subset = parseWith(envFields.pick({ DATABASE_URL: true }), {
      DATABASE_URL: VALID_ENV.DATABASE_URL,
    });
    expect(subset).toEqual({ DATABASE_URL: VALID_ENV.DATABASE_URL });
  });
});

describe("getEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("parses process.env once and caches the result", () => {
    for (const [key, value] of Object.entries(VALID_ENV)) vi.stubEnv(key, value);
    const first = getEnv();
    vi.stubEnv("FERROEHR_BASE_URL", "http://changed.example");
    expect(getEnv()).toBe(first);
    expect(first.FERROEHR_BASE_URL).toBe(VALID_ENV.FERROEHR_BASE_URL);
  });
});
