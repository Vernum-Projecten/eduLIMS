// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Server-only environment configuration. Everything under src/server/ uses relative
// `.ts` imports so the CLI entry points (migrate, seed) run on plain Node type stripping.
import "@tanstack/react-start/server-only";
import { z } from "zod";
import { ROLES } from "../lib/roles.ts";
import { parseRoleMap } from "./idp-roles.ts";

const httpUrl = () => z.url({ protocol: /^https?$/ });
const optionalText = () => z.string().trim().min(1).optional();

/** Default `OIDC_ROLE_MAP`: the same IdP role names for Entra app roles and Keycloak roles. */
export const DEFAULT_ROLE_MAP =
  "edulims-student:student,edulims-teacher:teacher,edulims-admin:admin";

/** Entra ID multi-tenant aliases: only the configured organisation tenant may sign in. */
const MULTI_TENANT_ALIASES = new Set(["common", "organizations", "consumers"]);

/** Field schemas without cross-field rules, so subsets can be `.pick()`ed (e.g. by migrate). */
export const envFields = z.object({
  // Fail safe: an unset NODE_ENV counts as production, so dev login stays off.
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  BETTER_AUTH_SECRET: z.string().min(32, "must be at least 32 characters"),
  BETTER_AUTH_URL: httpUrl(),
  MICROSOFT_CLIENT_ID: optionalText(),
  MICROSOFT_CLIENT_SECRET: optionalText(),
  MICROSOFT_TENANT_ID: optionalText().refine(
    (tenant) => tenant === undefined || !MULTI_TENANT_ALIASES.has(tenant.toLowerCase()),
    { error: "must be the organisation tenant ID, not a multi-tenant alias" },
  ),
  KEYCLOAK_ISSUER: httpUrl().optional(),
  KEYCLOAK_CLIENT_ID: optionalText(),
  KEYCLOAK_CLIENT_SECRET: optionalText(),
  /** Login button text for Keycloak in every locale; unset shows "Sign in with Keycloak", localized. */
  KEYCLOAK_LABEL: optionalText(),
  /** Dot path of the roles claim; defaults per provider (`roles`, `realm_access.roles`). */
  OIDC_ROLE_CLAIM: optionalText(),
  OIDC_ROLE_MAP: z
    .string()
    .default(DEFAULT_ROLE_MAP)
    .transform((text, ctx) => {
      try {
        return parseRoleMap(text);
      } catch (error) {
        ctx.addIssue({ code: "custom", message: (error as Error).message });
        return z.NEVER;
      }
    }),
  OIDC_DEFAULT_ROLE: z.enum(ROLES).optional(),
  FERROEHR_BASE_URL: httpUrl(),
  FERROBRIDGE_BASE_URL: httpUrl(),
  EDULIMS_DEV_LOGIN: z.stringbool().default(false),
});

const PROVIDER_VARS = {
  microsoft: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET", "MICROSOFT_TENANT_ID"],
  keycloak: ["KEYCLOAK_ISSUER", "KEYCLOAK_CLIENT_ID", "KEYCLOAK_CLIENT_SECRET"],
} as const;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export const envSchema = envFields.superRefine((env, ctx) => {
  for (const vars of Object.values(PROVIDER_VARS)) {
    const missing = vars.filter((name) => env[name] === undefined);
    if (missing.length > 0 && missing.length < vars.length) {
      for (const name of missing) {
        ctx.addIssue({
          code: "custom",
          path: [name],
          message: `set together with ${vars.join(", ")}`,
        });
      }
    }
  }
  const production = env.NODE_ENV === "production";
  if (production && !isMicrosoftConfigured(env) && !isKeycloakConfigured(env)) {
    ctx.addIssue({
      code: "custom",
      path: ["MICROSOFT_CLIENT_ID"],
      message: "configure at least one identity provider (Microsoft or Keycloak) in production",
    });
  }
  if (env.KEYCLOAK_ISSUER) {
    const issuer = new URL(env.KEYCLOAK_ISSUER);
    const loopbackDev = !production && LOOPBACK_HOSTS.has(issuer.hostname);
    if (issuer.protocol !== "https:" && !loopbackDev) {
      ctx.addIssue({
        code: "custom",
        path: ["KEYCLOAK_ISSUER"],
        message: "must use https (http is only allowed on loopback outside production)",
      });
    }
  }
  if (env.NODE_ENV === "production" && env.EDULIMS_DEV_LOGIN) {
    ctx.addIssue({
      code: "custom",
      path: ["EDULIMS_DEV_LOGIN"],
      message: "dev login must not be enabled when NODE_ENV=production",
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

/** Narrows `env` when all Microsoft Entra ID variables are set. */
export function isMicrosoftConfigured(env: Pick<Env, (typeof PROVIDER_VARS.microsoft)[number]>) {
  return PROVIDER_VARS.microsoft.every((name) => env[name] !== undefined);
}

/** Narrows `env` when all Keycloak variables are set. */
export function isKeycloakConfigured(env: Pick<Env, (typeof PROVIDER_VARS.keycloak)[number]>) {
  return PROVIDER_VARS.keycloak.every((name) => env[name] !== undefined);
}

/** Parses an environment record, throwing one readable error listing every invalid variable. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  return parseWith(envSchema, source);
}

/** Parses with any schema (e.g. `envFields.pick(...)`) using the same error formatting. */
export function parseWith<T extends z.ZodType>(
  schema: T,
  source: Record<string, string | undefined>,
): z.output<T> {
  const result = schema.safeParse(source);
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
