// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ROLE_MAP,
  envFields,
  getEnv,
  isKeycloakConfigured,
  isMicrosoftConfigured,
  parseEnv,
  parseWith,
} from "./env.ts";
import { parseRoleMap } from "./idp-roles.ts";
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
    expect(() => parseEnv({})).toThrow(/DATABASE_URL[\s\S]*BETTER_AUTH_SECRET/);
  });
});

const KEYCLOAK = {
  KEYCLOAK_ISSUER: "https://idp.example/realms/edulims",
  KEYCLOAK_CLIENT_ID: "edulims",
  KEYCLOAK_CLIENT_SECRET: "kc-secret",
};
const NO_MICROSOFT = {
  MICROSOFT_CLIENT_ID: undefined,
  MICROSOFT_CLIENT_SECRET: undefined,
  MICROSOFT_TENANT_ID: undefined,
};
const PRODUCTION = {
  NODE_ENV: "production",
  BETTER_AUTH_URL: "https://edulims.example",
  EDULIMS_DEV_LOGIN: "false",
};

describe("identity providers", () => {
  it("accepts Keycloak only, Microsoft only, or both", () => {
    expect(isKeycloakConfigured(parseEnv({ ...VALID_ENV, ...NO_MICROSOFT, ...KEYCLOAK }))).toBe(
      true,
    );
    const microsoftOnly = parseEnv({ ...VALID_ENV, ...PRODUCTION });
    expect(isMicrosoftConfigured(microsoftOnly)).toBe(true);
    expect(isKeycloakConfigured(microsoftOnly)).toBe(false);
    const both = parseEnv({ ...VALID_ENV, ...KEYCLOAK, ...PRODUCTION });
    expect(isMicrosoftConfigured(both) && isKeycloakConfigured(both)).toBe(true);
  });

  it("requires at least one identity provider in production", () => {
    expect(() => parseEnv({ ...VALID_ENV, ...NO_MICROSOFT, ...PRODUCTION })).toThrow(
      /at least one identity provider/,
    );
  });

  it("allows no identity provider outside production (dev login only)", () => {
    expect(isMicrosoftConfigured(parseEnv({ ...VALID_ENV, ...NO_MICROSOFT }))).toBe(false);
  });

  it.each([
    ["MICROSOFT_TENANT_ID", { ...VALID_ENV, MICROSOFT_TENANT_ID: undefined }],
    ["KEYCLOAK_CLIENT_SECRET", { ...VALID_ENV, ...KEYCLOAK, KEYCLOAK_CLIENT_SECRET: undefined }],
    ["KEYCLOAK_ISSUER", { ...VALID_ENV, KEYCLOAK_CLIENT_ID: "edulims" }],
  ])("requires all variables of a provider together (missing %s)", (missing, source) => {
    expect(() => parseEnv(source)).toThrow(new RegExp(`set together[\\s\\S]*${missing}`));
  });

  it("requires an https Keycloak issuer in production, even on loopback", () => {
    const issuer = { KEYCLOAK_ISSUER: "http://localhost:8080/realms/edulims" };
    expect(() => parseEnv({ ...VALID_ENV, ...KEYCLOAK, ...issuer, ...PRODUCTION })).toThrow(
      /KEYCLOAK_ISSUER/,
    );
  });

  it("allows an http Keycloak issuer only on loopback outside production", () => {
    for (const host of ["localhost:8080", "127.0.0.1:8080", "[::1]:8080"]) {
      const env = parseEnv({
        ...VALID_ENV,
        ...KEYCLOAK,
        KEYCLOAK_ISSUER: `http://${host}/realms/x`,
      });
      expect(env.KEYCLOAK_ISSUER).toBe(`http://${host}/realms/x`);
    }
    const remote = { KEYCLOAK_ISSUER: "http://idp.example/realms/edulims" };
    expect(() => parseEnv({ ...VALID_ENV, ...KEYCLOAK, ...remote })).toThrow(/KEYCLOAK_ISSUER/);
  });

  it("defaults the Keycloak label and the IdP role map", () => {
    const env = parseEnv({ ...VALID_ENV, ...KEYCLOAK });
    expect(env.KEYCLOAK_LABEL).toBe("Inloggen met Keycloak");
    expect(env.OIDC_ROLE_MAP).toEqual(parseRoleMap(DEFAULT_ROLE_MAP));
    expect(env.OIDC_DEFAULT_ROLE).toBeUndefined();
  });

  it.each([
    ["OIDC_ROLE_MAP", "edulims-docent:admin"],
    ["OIDC_ROLE_MAP", ""],
    ["OIDC_DEFAULT_ROLE", "admin"],
  ])("rejects an invalid %s (%j)", (key, value) => {
    expect(() => parseEnv({ ...VALID_ENV, [key]: value })).toThrow(new RegExp(key));
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
