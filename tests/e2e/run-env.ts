// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// What makes one `pnpm test:e2e` run independent of another on the same machine: a run id, a
// database of its own and ports derived from the run id. The config evaluates this in the runner
// and again in every worker; the first evaluation stores each value in process.env, which the
// workers inherit, so all of them agree.
import { createHash } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import {
  databaseOf,
  newRunId,
  runDatabaseName,
  staleRunDatabases,
  withDatabase,
} from "../../src/server/db/test-run-database.ts";

/**
 * The ports a run picks from: below the ephemeral ranges of Linux (from 32768) and macOS and
 * Windows (from 49152). A port the kernel hands out for port 0 is not held between the probe and
 * the server's start, so another run's outgoing connection or its own probe could take it (#321).
 */
export const RUN_PORT_RANGE = { first: 20_000, count: 10_000 } as const;

/**
 * Returns the ports `envName` of the run `id` tries, in order: a start derived from the run id
 * and the name, then the ports after it, wrapping within {@link RUN_PORT_RANGE}.
 */
export function runPortCandidates(id: string, envName: string, tries = 50): number[] {
  const hash = createHash("sha256").update(`${id}:${envName}`).digest().readUInt32BE(0);
  const start = hash % RUN_PORT_RANGE.count;
  return Array.from(
    { length: tries },
    (_, step) => RUN_PORT_RANGE.first + ((start + step) % RUN_PORT_RANGE.count),
  );
}

/** Resolves whether a server can listen on `port` at `host` (all interfaces when undefined). */
function canListen(port: number, host: string | undefined): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", (error) => {
      // NOTE: a host without IPv6 cannot test "::1"; no requirement governs this: our own design.
      const code = Reflect.get(error, "code");
      resolve(host === "::1" && (code === "EADDRNOTAVAIL" || code === "EAFNOSUPPORT"));
    });
    server.listen({ port, host, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

/** Returns whether nothing listens on `port`, on any interface the app or a spec may use. */
async function isFree(port: number): Promise<boolean> {
  for (const host of [undefined, "127.0.0.1", "::1"]) {
    if (!(await canListen(port, host))) return false;
  }
  return true;
}

/** The ports this run already holds in the environment, so two names never share one. */
function heldPorts(): Set<number> {
  return new Set(
    Object.entries(process.env)
      .filter(([name]) => name.startsWith("EDULIMS_E2E_") && name.endsWith("_PORT"))
      .map(([, value]) => Number(value)),
  );
}

/**
 * Returns the port this run uses for `envName`: the one an earlier evaluation stored, else the
 * first free one of {@link runPortCandidates} for this run id, stored for the workers. Two runs
 * have different ids, so they start from different ports.
 *
 * @throws Error when none of the candidates is free.
 */
export async function runPort(envName: string): Promise<number> {
  const stored = process.env[envName];
  if (stored !== undefined) {
    const port = Number(stored);
    if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
      throw new Error(`${envName}=${stored} is not a port.`);
    }
    return port;
  }
  const held = heldPorts();
  const candidates = runPortCandidates(runId(), envName);
  for (const port of candidates) {
    if (held.has(port) || !(await isFree(port))) continue;
    process.env[envName] = String(port);
    return port;
  }
  throw new Error(
    `No free port for ${envName} among ${candidates.at(0)} to ${candidates.at(-1)}; set ${envName}.`,
  );
}

/** The id of this e2e run, stored for the workers. */
export function runId(): string {
  process.env["EDULIMS_E2E_RUN_ID"] ??= newRunId();
  return process.env["EDULIMS_E2E_RUN_ID"];
}

/** Returns the URL of this run's database, next to the database `baseUrl` names. */
export function runDatabaseUrl(baseUrl: string): string {
  return withDatabase(baseUrl, runDatabaseName(databaseOf(baseUrl), runId()));
}

/** The folder that holds every run's own output folder. */
export const OUTPUT_ROOT = "test-results";

/** The base name of a run's output folder, `run_<run id>`, read like a run database name. */
const OUTPUT_BASE = "run";

/**
 * Returns this run's output folder under {@link OUTPUT_ROOT}. Playwright empties its output
 * folder when a run starts, so a shared one loses the traces another run in the same checkout
 * is still writing.
 */
export function runOutputDir(): string {
  return join(OUTPUT_ROOT, runDatabaseName(OUTPUT_BASE, runId()));
}

/**
 * Removes the output folders of runs that started more than `STALE_RUN_DATABASE_MS` before
 * `now`, as the run database of a crashed run is dropped; a recent folder may belong to a run
 * that is still going.
 */
export async function removeStaleOutputDirs(root: string, now: Date = new Date()): Promise<void> {
  const names = await readdir(root).catch((error: unknown) => {
    if (Reflect.get(Object(error), "code") === "ENOENT") return [];
    throw error;
  });
  for (const name of staleRunDatabases(OUTPUT_BASE, names, now)) {
    await rm(join(root, name), { recursive: true, force: true });
  }
}

/** The URL of the app under test, set by playwright.config.ts for the cookies the specs add. */
export function appUrl(): string {
  const url = process.env["EDULIMS_E2E_BASE_URL"];
  if (!url) throw new Error("EDULIMS_E2E_BASE_URL is not set: run the specs through Playwright.");
  return url;
}

/**
 * Returns the development Keycloak realm the Keycloak journeys sign in through: an outside
 * service on its own fixed port (`compose.dev.yaml`), unlike the app's per-run port.
 */
export function keycloakRealm(): string {
  const port = process.env["EDULIMS_DEV_KEYCLOAK_PORT"] ?? "8180";
  return process.env["EDULIMS_E2E_KEYCLOAK_REALM"] ?? `http://localhost:${port}/realms/edulims`;
}

/**
 * The secret values the e2e app runs with: public, e2e-only values that playwright.config.ts
 * passes to the server, and that the system page journey checks the page against (#36).
 */
export const E2E_SECRETS = {
  BETTER_AUTH_SECRET: "e2e-only-secret-not-for-production-use-0123456789",
  // A public e2e-only key: 32 bytes, base64.
  EDULIMS_DATA_KEY: "ZWR1bGltcy1lMmUtZGF0YS1rZXktMDEyMzQ1Njc4OTA=",
} as const;
