// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The e2e web server command (#192, #248): Playwright spawns it in a shell and forwards stderr
// only, so these cases spawn it the same way and read what each stream carries.
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  decodeSetupSteps,
  encodeSetupSteps,
  type SetupStep,
  setupThenServe,
  webServerTimeout,
} from "../e2e/web-server-command.ts";

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(command: string): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

/** A command that writes `text` to stdout, as the seed writes its summary. */
function prints(text: string): string {
  return `node -e "process.stdout.write('${text}\\n')"`;
}

/** A setup step that runs `command` within a bound far above what it needs. */
function step(command: string): SetupStep {
  return { command, timeoutMs: 30_000 };
}

describe("the e2e web server command (#192)", () => {
  it("sends every setup step's stdout to stderr, the stream Playwright logs", async () => {
    const result = await run(
      setupThenServe(
        [step(prints("database created")), step(prints("seed summary"))],
        prints("serving"),
      ),
    );
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("database created\n");
    expect(result.stderr).toContain("seed summary\n");
    expect(result.stdout).not.toContain("seed summary");
  });

  it("keeps the server's own stdout on stdout, out of the run log", async () => {
    const result = await run(
      setupThenServe([step(prints("seed summary"))], prints("security event")),
    );
    expect(result.stdout).toBe("security event\n");
    expect(result.stderr).not.toContain("security event");
  });

  it("starts no server when a setup step fails, and names the step", async () => {
    const fails = `node -e "process.exit(3)"`;
    const result = await run(
      setupThenServe([step(prints("seed summary")), step(fails)], prints("serving")),
    );
    expect(result.code).toBe(3);
    expect(result.stdout).not.toContain("serving");
    expect(result.stderr).toContain(`e2e setup: "${fails}" failed with exit code 3`);
  });

  it("refuses an empty setup", () => {
    expect(() => setupThenServe([], "pnpm start")).toThrow(Error);
  });

  it("logs the time each setup step took (#248)", async () => {
    const result = await run(setupThenServe([step(prints("seed summary"))], prints("serving")));
    expect(result.stderr).toMatch(/e2e setup: "node -e .*" took \d+\.\d s\.\n/);
  });

  it("stops a step that outlives its bound, names it, and starts no server (#248)", async () => {
    const hangs = `node -e "setTimeout(() => {}, 60000)"`;
    const started = performance.now();
    const result = await run(
      setupThenServe(
        [step(prints("database created")), { command: hangs, timeoutMs: 500 }],
        prints("serving"),
      ),
    );
    expect(result.code).toBe(124);
    expect(result.stderr).toContain(`e2e setup: "${hangs}" did not finish within 0.5 s`);
    expect(result.stdout).not.toContain("serving");
    // The hanging step is stopped, not waited out.
    expect(performance.now() - started).toBeLessThan(30_000);
  });

  it("gives Playwright every step's bound plus the start (#248)", () => {
    const steps = [
      { command: "a", timeoutMs: 1_000 },
      { command: "b", timeoutMs: 2_000 },
    ];
    expect(webServerTimeout(steps, 4_000)).toBe(7_000);
  });

  it("round-trips the steps and refuses a list without them or a step without a bound (#248)", () => {
    const steps = [{ command: "pnpm db:reset", timeoutMs: 1_000 }];
    expect(decodeSetupSteps(encodeSetupSteps(steps))).toEqual(steps);
    const unbounded = encodeSetupSteps([{ command: "x", timeoutMs: 0 }]);
    expect(() => decodeSetupSteps(unbounded)).toThrow(/no positive bound/);
    expect(() => decodeSetupSteps(encodeSetupSteps([]))).toThrow(/not a non-empty list/);
  });
});
