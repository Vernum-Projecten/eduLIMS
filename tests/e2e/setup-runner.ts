// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Runs the e2e web server's setup steps one after the other, each within its own bound (#248).
// Each step's output goes to the log (stderr, the stream Playwright logs, #192), followed by the
// time it took. A step that fails or outlives its bound stops the setup with a message naming the
// step, so a slow machine reads as "this step took too long", never as a web server that never
// came up. setup-steps.ts is the command-line entry; the unit tests call runSetup in their own
// process with the log in memory, so a case starts no Node.js process and writes no file (#302).
import { spawn } from "node:child_process";
import type { Writable } from "node:stream";
import type { SetupStep } from "./web-server-command.ts";

/** How a step ended: its exit code, or the bound it outlived. */
type Outcome = { kind: "exited"; code: number | null } | { kind: "timed_out" };

/** The exit code of a setup whose step outlived its bound, as `timeout(1)` uses. */
export const TIMED_OUT_EXIT_CODE = 124;

function runStep(step: SetupStep, log: Writable): Promise<Outcome> {
  return new Promise((resolve, reject) => {
    // A group of its own, so a bound that runs out stops the step's children too (pnpm, node).
    const child = spawn(step.command, {
      shell: true,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    const timer = setTimeout(() => {
      if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      resolve({ kind: "timed_out" });
    }, step.timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    // "close" comes after the step's output has reached the log, so its time line follows it.
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ kind: "exited", code });
    });
  });
}

/**
 * Runs `steps` in order with their output on `log`, and resolves to the exit code the setup
 * command ends with: 0 when every step passed, the failing step's code, or
 * {@link TIMED_OUT_EXIT_CODE} for a step that outlived its bound. No step after a failing one runs.
 */
export async function runSetup(steps: readonly SetupStep[], log: Writable): Promise<number> {
  for (const step of steps) {
    const started = performance.now();
    const outcome = await runStep(step, log);
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    if (outcome.kind === "timed_out") {
      log.write(
        `e2e setup: "${step.command}" did not finish within ${step.timeoutMs / 1000} s; stopped it.\n`,
      );
      return TIMED_OUT_EXIT_CODE;
    }
    if (outcome.code !== 0) {
      log.write(
        `e2e setup: "${step.command}" failed with exit code ${outcome.code} after ${seconds} s.\n`,
      );
      return outcome.code ?? 1;
    }
    log.write(`e2e setup: "${step.command}" took ${seconds} s.\n`);
  }
  return 0;
}
