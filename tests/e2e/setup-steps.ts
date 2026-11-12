// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Runs the e2e web server's setup steps one after the other, each within its own bound (#248).
// Each step's output goes to stderr, the stream Playwright logs (#192), followed by the time it
// took. A step that fails or outlives its bound stops the setup with a message naming the step,
// so a slow machine reads as "this step took too long", never as a web server that never came up.
// Runs on plain Node (type stripping): `node tests/e2e/setup-steps.ts <steps>`, where `<steps>`
// is the base64url JSON that web-server-command.ts encodes.
import { spawn } from "node:child_process";
import { decodeSetupSteps, type SetupStep } from "./web-server-command.ts";

/** How a step ended: its exit code, or the bound it outlived. */
type Outcome = { kind: "exited"; code: number | null } | { kind: "timed_out" };

function run(step: SetupStep): Promise<Outcome> {
  return new Promise((resolve, reject) => {
    // A group of its own, so a bound that runs out stops the step's children too (pnpm, node).
    const child = spawn(step.command, {
      shell: true,
      detached: true,
      stdio: ["ignore", process.stderr, process.stderr],
    });
    const timer = setTimeout(() => {
      if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      resolve({ kind: "timed_out" });
    }, step.timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve({ kind: "exited", code });
    });
  });
}

const encoded = process.argv[2];
if (encoded === undefined) throw new Error("Usage: setup-steps.ts <base64url JSON of the steps>");
for (const step of decodeSetupSteps(encoded)) {
  const started = performance.now();
  const outcome = await run(step);
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  if (outcome.kind === "timed_out") {
    process.stderr.write(
      `e2e setup: "${step.command}" did not finish within ${step.timeoutMs / 1000} s; stopped it.\n`,
    );
    process.exit(124);
  }
  if (outcome.code !== 0) {
    process.stderr.write(
      `e2e setup: "${step.command}" failed with exit code ${outcome.code} after ${seconds} s.\n`,
    );
    process.exit(outcome.code ?? 1);
  }
  process.stderr.write(`e2e setup: "${step.command}" took ${seconds} s.\n`);
}
