// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// What the host CLI tests share: the commands run through `runCli` on the test database, whose
// `destroy()` in the command rolls it back, with the security log stream captured. A test file
// mocks `openDatabase` (src/server/cli/host.ts) with `harness.open` and calls
// `installCliHarness()`.
import type { Kysely } from "kysely";
import { afterEach, beforeEach, expect, vi } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { invalidateProviderCache } from "../idp/registry.ts";
import { SECURITY_LOG_FIELDS, setSecurityLogWriter } from "../security-log.ts";
import { VALID_ENV } from "../test-env.ts";

/** The state of one CLI test. */
export interface CliHarness {
  current: Kysely<DB> | undefined;
  /** How often a command opened the database. */
  opened: number;
  /** The security log lines the test wrote. */
  logged: string[];
  /** The stand-in for `openDatabase`: the test's database, counted. */
  open(): Kysely<DB>;
}

/** The state of the running CLI test. */
export const harness: CliHarness = {
  current: undefined,
  opened: 0,
  logged: [],
  open(): Kysely<DB> {
    if (!harness.current) throw new Error("no test database");
    harness.opened += 1;
    return harness.current;
  },
};

const ENVELOPE = ["time", "level", "app", "log", "event"];

/** Personal data the fixtures hold: none of it may reach a log line. */
export const PERSONAL = /example\.test|Test (Teacher|Admin|Student)|@/;

/** Registers the hooks: a host environment, a fresh capture before each test, cleanup after. */
export function installCliHarness(): void {
  let restoreLog: (() => void) | undefined;
  beforeEach(() => {
    for (const key of ["DATABASE_URL", "BETTER_AUTH_URL", "EDULIMS_DATA_KEY"] as const) {
      vi.stubEnv(key, VALID_ENV[key]);
    }
    vi.stubEnv("EDULIMS_IDP_PRIVATE_ORIGINS", "");
    vi.stubEnv("EDULIMS_DATA_KEY_PREVIOUS", "");
    harness.logged = [];
    harness.opened = 0;
    restoreLog = setSecurityLogWriter((line) => harness.logged.push(line));
  });
  afterEach(async () => {
    restoreLog?.();
    restoreLog = undefined;
    vi.unstubAllEnvs();
    invalidateProviderCache();
    await harness.current?.destroy();
    harness.current = undefined;
  });
}

/** Opens the test's database, which the next command receives. */
export async function database(): Promise<Kysely<DB>> {
  harness.current = await createTestDb();
  return harness.current;
}

/** Inserts a user with a verified `<id>@example.test` address. */
export async function user(
  db: Kysely<DB>,
  id: string,
  role: string | null,
  name: string,
  emailVerified = true,
): Promise<void> {
  await db
    .insertInto("user")
    .values({ id, name, email: `${id}@example.test`, emailVerified, role })
    .execute();
}

/** Runs the host CLI and returns its exit code and output lines. */
export async function run(...args: string[]): Promise<{ code: number; lines: string[] }> {
  // A dynamic import: the CLI loads the mocked host module, which this module must not wait on.
  const { runCli } = await import("../cli.ts");
  const lines: string[] = [];
  const code = await runCli(args, (line) => lines.push(line));
  return { code, lines };
}

/** The parsed stream lines, after checking each against the allowlist and for personal data. */
export function stream(): Record<string, unknown>[] {
  const allowed: readonly string[] = [...ENVELOPE, ...SECURITY_LOG_FIELDS];
  return harness.logged.map((text) => {
    expect(text).not.toMatch(PERSONAL);
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) throw new Error("not a JSON object");
    const line = Object.fromEntries(Object.entries(parsed));
    expect(Object.keys(line).filter((key) => !allowed.includes(key))).toEqual([]);
    return line;
  });
}
