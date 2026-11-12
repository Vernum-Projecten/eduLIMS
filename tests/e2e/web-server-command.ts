// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

/**
 * Returns the Playwright `webServer` command that runs the `setup` steps, then `serve`.
 *
 * Playwright forwards only the command's stderr to the run log (`webServer.stdout` defaults to
 * `"ignore"`), so the setup steps' stdout, the seed's summary among it, goes to stderr. The
 * server's own stdout, the JSON security log, stays out of the run log. Each step runs only
 * when the one before it succeeded.
 */
export function setupThenServe(setup: readonly string[], serve: string): string {
  if (setup.length === 0) throw new Error("setupThenServe needs at least one setup step");
  return `(${setup.join(" && ")}) 1>&2 && ${serve}`;
}
