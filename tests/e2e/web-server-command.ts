// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

/** One setup step of the e2e web server: a shell command and the time it may take. */
export interface SetupStep {
  readonly command: string;
  readonly timeoutMs: number;
}

/** Encodes `steps` as one shell-safe argument for setup-steps.ts. */
export function encodeSetupSteps(steps: readonly SetupStep[]): string {
  return Buffer.from(JSON.stringify(steps), "utf8").toString("base64url");
}

/** Decodes the argument {@link encodeSetupSteps} made, refusing anything else. */
export function decodeSetupSteps(encoded: string): SetupStep[] {
  const parsed: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("The e2e setup steps are not a non-empty list.");
  }
  return parsed.map((step: unknown) => {
    const command: unknown = typeof step === "object" && step ? Reflect.get(step, "command") : null;
    const timeoutMs: unknown =
      typeof step === "object" && step ? Reflect.get(step, "timeoutMs") : null;
    if (typeof command !== "string" || command === "") {
      throw new Error("An e2e setup step has no command.");
    }
    if (typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      throw new Error(`The e2e setup step "${command}" has no positive bound.`);
    }
    return { command, timeoutMs };
  });
}

/** The time Playwright waits for the whole web server: every step's bound plus `serveMs`. */
export function webServerTimeout(setup: readonly SetupStep[], serveMs: number): number {
  return setup.reduce((total, step) => total + step.timeoutMs, serveMs);
}

/**
 * Returns the Playwright `webServer` command that runs the `setup` steps, then `serve`.
 *
 * Playwright forwards only the command's stderr to the run log (`webServer.stdout` defaults to
 * `"ignore"`), so setup-steps.ts sends each step's output there, with its time, and stops at the
 * first step that fails or outlives its bound, naming it (#248). The server's own stdout, the
 * JSON security log, stays out of the run log.
 */
export function setupThenServe(setup: readonly SetupStep[], serve: string): string {
  if (setup.length === 0) throw new Error("setupThenServe needs at least one setup step");
  return `node tests/e2e/setup-steps.ts ${encodeSetupSteps(setup)} && ${serve}`;
}
