// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Server-only environment configuration. Everything under src/server/ uses relative
// `.ts` imports so the CLI entry points (migrate, seed) run on plain Node type stripping.
import "@tanstack/react-start/server-only";
import { z } from "zod";

/** Entra ID multi-tenant aliases: only the Hanze tenant may sign in. */
const httpUrl = () => z.url({ protocol: /^https?$/ });

const MULTI_TENANT_ALIASES = new Set(["common", "organizations", "consumers"]);

/** Field schemas without cross-field rules, so subsets can be `.pick()`ed (e.g. by migrate). */
export const envFields = z.object({
  // Fail safe: an unset NODE_ENV counts as production, so dev login stays off.
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  BETTER_AUTH_SECRET: z.string().min(32, "must be at least 32 characters"),
  BETTER_AUTH_URL: httpUrl(),
  MICROSOFT_CLIENT_ID: z.string().min(1),
  MICROSOFT_CLIENT_SECRET: z.string().min(1),
  MICROSOFT_TENANT_ID: z
    .string()
    .min(1)
    .refine((tenant) => !MULTI_TENANT_ALIASES.has(tenant.toLowerCase()), {
      error: "must be the Hanze tenant ID, not a multi-tenant alias",
    }),
  FERROEHR_BASE_URL: httpUrl(),
  FERROBRIDGE_BASE_URL: httpUrl(),
  EDULIMS_DEV_LOGIN: z.stringbool().default(false),
});

export const envSchema = envFields.superRefine((env, ctx) => {
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
