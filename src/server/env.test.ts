// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  databaseTlsProblem,
  EnvConfigError,
  envFields,
  getEnv,
  parseEnv,
  parseWith,
} from "./env.ts";
import { VALID_ENV } from "./test-env.ts";

const VERIFIED_DATABASE_URL =
  "postgres://edulims:secret@postgres:5432/edulims?sslmode=verify-full&sslrootcert=/etc/edulims/postgres-ca.crt";

describe("parseEnv", () => {
  it("accepts a complete environment and coerces EDULIMS_DEV_LOGIN to a boolean", () => {
    const env = parseEnv(VALID_ENV);
    expect(env.EDULIMS_DEV_LOGIN).toBe(true);
    expect(env.NODE_ENV).toBe("test");
  });

  it("defaults to production with dev login disabled", () => {
    const {
      NODE_ENV: _,
      EDULIMS_DEV_LOGIN: __,
      EDULIMS_IDP_PRIVATE_ORIGINS: ___,
      ...rest
    } = VALID_ENV;
    const env = parseEnv({
      ...rest,
      BETTER_AUTH_URL: "https://edulims.example",
      DATABASE_URL: VERIFIED_DATABASE_URL,
    });
    expect(env.NODE_ENV).toBe("production");
    expect(env.EDULIMS_DEV_LOGIN).toBe(false);
  });

  it("treats an empty or blank variable as unset, as `VAR=` in an env file means", () => {
    const env = parseEnv({
      ...VALID_ENV,
      EDULIMS_DATA_KEY_PREVIOUS: "  ",
      EDULIMS_IDP_PRIVATE_ORIGINS: "",
    });
    expect(env.EDULIMS_DATA_KEY_PREVIOUS).toBeUndefined();
    expect(env.EDULIMS_IDP_PRIVATE_ORIGINS).toEqual([]);
  });

  it("still refuses an empty required variable", () => {
    expect(() => parseEnv({ ...VALID_ENV, BETTER_AUTH_SECRET: "" })).toThrow(/BETTER_AUTH_SECRET/);
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
    ["EDULIMS_DATA_KEY", "too-short"],
    ["EDULIMS_DATA_KEY", "ZWR1bGltcw=="],
    ["EDULIMS_IDP_PRIVATE_ORIGINS", "localhost:8180"],
    ["EDULIMS_IDP_PRIVATE_ORIGINS", "http://localhost:8180/realms/edulims"],
    ["FERROEHR_BASE_URL", "ftp://ferro.example"],
    ["EDULIMS_DEV_LOGIN", "maybe"],
  ])("rejects an invalid %s (%s)", (key, value) => {
    expect(() => parseEnv({ ...VALID_ENV, [key]: value })).toThrow(new RegExp(key));
  });

  it("names a bad private origin by its position, never by its value (V16.2.5)", () => {
    const value = "http://localhost:8180, http://secret-host.internal/path";
    let thrown: unknown;
    try {
      parseEnv({ ...VALID_ENV, EDULIMS_IDP_PRIVATE_ORIGINS: value });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(EnvConfigError);
    if (!(thrown instanceof EnvConfigError)) return;
    expect(thrown.variables).toEqual(["EDULIMS_IDP_PRIVATE_ORIGINS"]);
    expect(thrown.message).toMatch(/entry 2 is not an http\(s\) origin/);
    expect(thrown.message).not.toContain("secret-host");
  });

  it("lists every missing variable in one error", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL[\s\S]*BETTER_AUTH_SECRET/);
  });
});

const PRODUCTION = {
  NODE_ENV: "production",
  DATABASE_URL: VERIFIED_DATABASE_URL,
  BETTER_AUTH_URL: "https://edulims.example",
  EDULIMS_DEV_LOGIN: "false",
  EDULIMS_IDP_PRIVATE_ORIGINS: "https://idp.campus.internal",
};

describe("identity-provider settings (#46, ADR 0015)", () => {
  it("requires EDULIMS_DATA_KEY in production (ASVS V11.3.2)", () => {
    const { EDULIMS_DATA_KEY: _, ...rest } = VALID_ENV;
    expect(() => parseEnv({ ...rest, ...PRODUCTION })).toThrow(/EDULIMS_DATA_KEY/);
    expect(parseEnv({ ...VALID_ENV, ...PRODUCTION }).EDULIMS_DATA_KEY).toBe(
      VALID_ENV.EDULIMS_DATA_KEY,
    );
  });

  it("allows no data key outside production", () => {
    const { EDULIMS_DATA_KEY: _, ...rest } = VALID_ENV;
    expect(parseEnv(rest).EDULIMS_DATA_KEY).toBeUndefined();
  });

  it("accepts a previous key only beside a current one (rotation)", () => {
    const { EDULIMS_DATA_KEY: key, ...rest } = VALID_ENV;
    expect(() => parseEnv({ ...rest, EDULIMS_DATA_KEY_PREVIOUS: key })).toThrow(
      /EDULIMS_DATA_KEY_PREVIOUS/,
    );
    expect(
      parseEnv({ ...VALID_ENV, EDULIMS_DATA_KEY_PREVIOUS: key }).EDULIMS_DATA_KEY_PREVIOUS,
    ).toBe(key);
  });

  it("parses the private IdP origins, without a path", () => {
    const env = parseEnv({
      ...VALID_ENV,
      EDULIMS_IDP_PRIVATE_ORIGINS: "http://localhost:8180, https://idp.campus.internal",
    });
    expect(env.EDULIMS_IDP_PRIVATE_ORIGINS).toEqual([
      "http://localhost:8180",
      "https://idp.campus.internal",
    ]);
  });

  it("refuses an http private IdP origin in production (L2)", () => {
    const plain = {
      ...VALID_ENV,
      ...PRODUCTION,
      EDULIMS_IDP_PRIVATE_ORIGINS: "http://localhost:8180",
    };
    expect(() => parseEnv(plain)).toThrow(/EDULIMS_IDP_PRIVATE_ORIGINS/);
    expect(parseEnv({ ...VALID_ENV, ...PRODUCTION }).EDULIMS_IDP_PRIVATE_ORIGINS).toEqual([
      "https://idp.campus.internal",
    ]);
  });

  it.each(["MICROSOFT_CLIENT_ID", "KEYCLOAK_ISSUER", "OIDC_ROLE_MAP"])(
    "ignores the retired variable %s (providers live in the database)",
    (name) => {
      expect(Object.keys(parseEnv({ ...VALID_ENV, [name]: "x" }))).not.toContain(name);
    },
  );
});

describe("PostgreSQL TLS in production (#40, ASVS V12.3.1)", () => {
  const production = { ...VALID_ENV, ...PRODUCTION };

  it("accepts sslmode=verify-full, with or without a CA file", () => {
    expect(parseEnv(production).DATABASE_URL).toBe(VERIFIED_DATABASE_URL);
    const systemCa = "postgres://edulims:secret@db.example:5432/edulims?sslmode=verify-full";
    expect(parseEnv({ ...production, DATABASE_URL: systemCa }).DATABASE_URL).toBe(systemCa);
  });

  it.each([
    ["no sslmode", "postgres://edulims:secret@postgres:5432/edulims"],
    ["sslmode=disable", "postgres://edulims:secret@postgres:5432/edulims?sslmode=disable"],
    ["sslmode=require", "postgres://edulims:secret@postgres:5432/edulims?sslmode=require"],
    ["sslmode=verify-ca", "postgres://edulims:secret@postgres:5432/edulims?sslmode=verify-ca"],
    ["sslmode=prefer", "postgres://edulims:secret@postgres:5432/edulims?sslmode=prefer"],
  ])("refuses a DATABASE_URL with %s", (_case, url) => {
    expect(() => parseEnv({ ...production, DATABASE_URL: url })).toThrow(
      /sslmode=verify-full[\s\S]*DATABASE_URL/,
    );
  });

  it("keeps the plain development database outside production", () => {
    expect(parseEnv(VALID_ENV).DATABASE_URL).toBe(VALID_ENV.DATABASE_URL);
  });

  it("reports nothing for a verified URL and the reason for any other", () => {
    expect(databaseTlsProblem(VERIFIED_DATABASE_URL)).toBeUndefined();
    expect(databaseTlsProblem(VALID_ENV.DATABASE_URL)).toMatch(/verify-full/);
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
