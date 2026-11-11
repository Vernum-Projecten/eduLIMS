// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// What makes one `pnpm test:e2e` run independent of another on the same machine: a run id, a
// database of its own and free ports. The config evaluates this in the runner and again in every
// worker; the first evaluation stores each value in process.env, which the workers inherit, so
// all of them agree.
import { createServer } from "node:net";
import {
  databaseOf,
  newRunId,
  runDatabaseName,
  withDatabase,
} from "../../src/server/db/test-run-database.ts";

/** Returns a TCP port on 127.0.0.1 that nothing listens on right now. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address !== null && typeof address === "object") resolve(address.port);
        else reject(new Error("The probe server reported no port."));
      });
    });
  });
}

/**
 * Returns the port this run uses for `envName`: the one an earlier evaluation stored, else a free
 * one, stored for the workers. A second Playwright project (a dev server) calls it with its own
 * name to get a port of its own.
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
  const port = await freePort();
  process.env[envName] = String(port);
  return port;
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
