// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Server-only environment configuration. Everything under src/server/ uses relative
// `.ts` imports so the CLI entry points (migrate, seed) run on plain Node type stripping.
import "@tanstack/react-start/server-only";
import { isIP } from "node:net";
import { z } from "zod";

const httpUrl = () => z.url({ protocol: /^https?$/ });

/** A 32-byte AES-256 key, base64 (`openssl rand -base64 32`). */
const dataKey = () =>
  z
    .string()
    .trim()
    .refine(
      (text) => /^[A-Za-z0-9+/]{43}=$/.test(text) && Buffer.from(text, "base64").length === 32,
      {
        error: "must be 32 random bytes, base64 (openssl rand -base64 32)",
      },
    );

/**
 * `EDULIMS_IDP_PRIVATE_ORIGINS`: comma-separated origins of identity providers on a private or
 * loopback network (an on-premises IdP, the development Keycloak), the only ones an issuer may
 * resolve to besides public addresses.
 */
const originList = () =>
  z.string().transform((text, ctx) => {
    const origins: string[] = [];
    for (const entry of text.split(",")) {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      try {
        const url = new URL(trimmed);
        if (url.origin !== trimmed.replace(/\/$/, "") || !/^https?:$/.test(url.protocol)) {
          throw new Error("not an origin");
        }
        origins.push(url.origin);
      } catch {
        ctx.addIssue({ code: "custom", message: `"${trimmed}" is not an http(s) origin` });
        return z.NEVER;
      }
    }
    return origins;
  });

/** Returns whether `entry` is an IP address or a CIDR range (`192.0.2.10`, `10.0.0.0/24`). */
export function isAddressOrRange(entry: string): boolean {
  const [address = "", prefix, ...rest] = entry.split("/");
  const family = isIP(address);
  if (family === 0 || rest.length > 0) return false;
  if (prefix === undefined) return true;
  return /^\d{1,3}$/.test(prefix) && Number(prefix) <= (family === 4 ? 32 : 128);
}

/**
 * `EDULIMS_TRUSTED_PROXIES`: comma-separated addresses or CIDR ranges of the reverse proxies in
 * front of eduLIMS. better-auth then reads the client IP from `X-Forwarded-For` from the right,
 * skipping these hops; unset, it trusts only a header with exactly one address.
 */
const proxyList = () =>
  z.string().transform((text, ctx) => {
    const entries = text
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== "");
    for (const entry of entries) {
      if (!isAddressOrRange(entry)) {
        ctx.addIssue({ code: "custom", message: `"${entry}" is not an IP address or CIDR range` });
        return z.NEVER;
      }
    }
    return entries;
  });

/** Field schemas without cross-field rules, so subsets can be `.pick()`ed (e.g. by migrate). */
export const envFields = z.object({
  // Fail safe: an unset NODE_ENV counts as production, so dev login stays off.
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  BETTER_AUTH_SECRET: z.string().min(32, "must be at least 32 characters"),
  BETTER_AUTH_URL: httpUrl(),
  /** The key that encrypts identity-provider secrets at rest (ADR 0015, ASVS V11.3.2). */
  EDULIMS_DATA_KEY: dataKey().optional(),
  /** The previous data key while `pnpm idp:rekey` re-encrypts (rotation, V11.1.1). */
  EDULIMS_DATA_KEY_PREVIOUS: dataKey().optional(),
  EDULIMS_IDP_PRIVATE_ORIGINS: originList().default([]),
  EDULIMS_TRUSTED_PROXIES: proxyList().default([]),
  FERROEHR_BASE_URL: httpUrl(),
  FERROBRIDGE_BASE_URL: httpUrl(),
  EDULIMS_DEV_LOGIN: z.stringbool().default(false),
});

/**
 * Returns why a production `DATABASE_URL` is refused, or `undefined` when it asks for TLS with
 * certificate and host name verification (`sslmode=verify-full`, optionally with
 * `sslrootcert=<CA file>`), which node-postgres reads from the URL itself.
 */
export function databaseTlsProblem(databaseUrl: string): string | undefined {
  // NOTE: owner decision on #40 (ASVS V12.3.1, V12.3.2): verified TLS to PostgreSQL in
  // production, with no opt-out; every other sslmode either skips TLS or skips verification.
  const mode = new URL(databaseUrl).searchParams.get("sslmode");
  if (mode === "verify-full") return undefined;
  return "must use sslmode=verify-full when NODE_ENV=production (TLS with a verified certificate)";
}

export const envSchema = envFields.superRefine((env, ctx) => {
  const production = env.NODE_ENV === "production";
  if (production && env.EDULIMS_DATA_KEY === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["EDULIMS_DATA_KEY"],
      message: "is required when NODE_ENV=production (it encrypts identity-provider secrets)",
    });
  }
  if (env.EDULIMS_DATA_KEY_PREVIOUS !== undefined && env.EDULIMS_DATA_KEY === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["EDULIMS_DATA_KEY_PREVIOUS"],
      message: "set only together with EDULIMS_DATA_KEY",
    });
  }
  const tlsProblem = production ? databaseTlsProblem(env.DATABASE_URL) : undefined;
  if (tlsProblem) ctx.addIssue({ code: "custom", path: ["DATABASE_URL"], message: tlsProblem });
  if (env.NODE_ENV === "production" && env.EDULIMS_DEV_LOGIN) {
    ctx.addIssue({
      code: "custom",
      path: ["EDULIMS_DEV_LOGIN"],
      message: "dev login must not be enabled when NODE_ENV=production",
    });
  }
  // NOTE: ASVS V12.2.1; a trusted IdP origin over plain http would carry tokens unencrypted.
  const plain = env.EDULIMS_IDP_PRIVATE_ORIGINS.filter((origin) => origin.startsWith("http:"));
  if (production && plain.length > 0) {
    ctx.addIssue({
      code: "custom",
      path: ["EDULIMS_IDP_PRIVATE_ORIGINS"],
      message: `must list https origins only when NODE_ENV=production (${plain.join(", ")})`,
    });
  }
  if (env.NODE_ENV === "production" && !env.BETTER_AUTH_URL.startsWith("https://")) {
    ctx.addIssue({
      code: "custom",
      path: ["BETTER_AUTH_URL"],
      message: "must use https when NODE_ENV=production",
    });
  }
});

export type Env = z.infer<typeof envSchema>;

/** Parses an environment record, throwing one readable error listing every invalid variable. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  return parseWith(envSchema, source);
}

/**
 * Parses with any schema (e.g. `envFields.pick(...)`) using the same error formatting.
 *
 * An empty or whitespace-only value counts as unset, so `VAR=` in an env file
 * switches an optional setting off instead of failing as "too short".
 */
export function parseWith<T extends z.ZodType>(
  schema: T,
  source: Record<string, string | undefined>,
): z.output<T> {
  const present = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value.trim() !== ""),
  );
  const result = schema.safeParse(present);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

let cached: Env | undefined;

/** Validated `process.env`, parsed once on first use (never at import time). */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
