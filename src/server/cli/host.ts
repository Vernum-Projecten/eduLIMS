// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// What the host CLIs (`pnpm idp:*`, `pnpm admin:*`) share: the environment they need and the
// database connection. They run with host access only, never over HTTP, and act as `system`.
// Runs on plain Node (type stripping), also in the migrate image; no message catalogue.
import { createInterface } from "node:readline/promises";
import { type ParseArgsOptionsConfig, parseArgs } from "node:util";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { DB } from "../db/schema.gen.ts";
import { databaseTlsProblem, EnvConfigError, envFields, parseWith } from "../env.ts";
import { keyringOf } from "../idp/crypto.ts";
import type { IdpServiceContext } from "../idp/service.ts";

const hostEnv = envFields.pick({
  DATABASE_URL: true,
  BETTER_AUTH_URL: true,
  EDULIMS_DATA_KEY: true,
  EDULIMS_DATA_KEY_PREVIOUS: true,
  EDULIMS_IDP_PRIVATE_ORIGINS: true,
});

/**
 * The environment of a host CLI, validated like the app's. Only an explicit NODE_ENV=production
 * (the migrate image) is production, as for `pnpm db:migrate` on a developer machine.
 */
export function hostEnvironment() {
  const production = process.env["NODE_ENV"] === "production";
  const env = { ...parseWith(hostEnv, process.env), production };
  const tls = production ? databaseTlsProblem(env.DATABASE_URL) : undefined;
  if (tls) throw new EnvConfigError(["DATABASE_URL"], `✖ ${tls}\n  → at DATABASE_URL`);
  if (production && !env.EDULIMS_DATA_KEY) {
    throw new EnvConfigError(["EDULIMS_DATA_KEY"], "✖ is required\n  → at EDULIMS_DATA_KEY");
  }
  return env;
}

/** Opens the database of `env`; the caller destroys it. */
export function openDatabase(env: { DATABASE_URL: string }): Kysely<DB> {
  return new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString: env.DATABASE_URL, max: 2 }),
    }),
  });
}

/** Returns the service context of a host CLI: actor `system`. */
export function systemContext(
  db: Kysely<DB>,
  env: ReturnType<typeof hostEnvironment>,
): IdpServiceContext {
  return {
    db,
    keyring: keyringOf(env),
    policy: {
      production: env.production,
      privateOrigins: env.EDULIMS_IDP_PRIVATE_ORIGINS,
    },
    baseURL: env.BETTER_AUTH_URL,
    actor: { type: "system" },
  };
}

/** Asks one question on the terminal; `null` when stdin is not a terminal. */
export async function ask(question: string): Promise<string | null> {
  if (!process.stdin.isTTY) return null;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/** Parses a subcommand's arguments strictly; `null` for an unknown option or a missing value. */
export function parseCliArgs<O extends ParseArgsOptionsConfig>(
  args: readonly string[],
  options: O,
) {
  try {
    return parseArgs({ args: [...args], options, allowPositionals: true, strict: true });
  } catch {
    return null;
  }
}
