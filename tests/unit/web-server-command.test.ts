// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The e2e web server command (#192, #248). The setup runner runs in this process with its log in
// memory, so those cases start only the shell of each step; one case runs the whole command in a
// shell as Playwright does, to prove the Node.js entry and the split of the two streams (#302).
import { spawn } from "node:child_process";
import { Writable } from "node:stream";
import { beforeEach, describe, expect, it } from "vitest";
import { runSetup, TIMED_OUT_EXIT_CODE } from "../e2e/setup-runner.ts";
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

/** A command that writes `text` to stdout, as the seed writes its summary; a shell builtin. */
function prints(text: string): string {
  return `printf '%s\\n' '${text}'`;
}

/** A setup step that runs `command` within a bound far above what it needs. */
function step(command: string): SetupStep {
  return { command, timeoutMs: 10_000 };
}

const WHOLE_COMMAND_SETUP = [step(prints("database created")), step(prints("seed summary"))];

// NOTE: #302: this case waits for a Node.js start, which outlived 5 s under load in all five old
// cases; every step is bounded, so it ends, and it gets the bound Playwright gives the command.
const WHOLE_COMMAND_BOUND_MS = webServerTimeout(WHOLE_COMMAND_SETUP, 10_000);

describe("the e2e web server command (#192)", () => {
  it(
    "sends the setup's output to stderr and keeps the server's stdout on stdout",
    async () => {
      const result = await run(setupThenServe(WHOLE_COMMAND_SETUP, prints("security event")));
      expect(result.code).toBe(0);
      expect(result.stderr).toContain("database created\n");
      expect(result.stderr).toContain("seed summary\n");
      expect(result.stdout).toBe("security event\n");
      expect(result.stderr).not.toContain("security event");
    },
    WHOLE_COMMAND_BOUND_MS,
  );

  it("starts the server only after the setup passed", () => {
    expect(setupThenServe([step(prints("seed summary"))], "pnpm start")).toMatch(
      /^node tests\/e2e\/setup-steps\.ts \S+ && pnpm start$/,
    );
  });

  it("refuses an empty setup", () => {
    expect(() => setupThenServe([], "pnpm start")).toThrow(Error);
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

describe("the e2e setup runner (#248)", () => {
  let chunks: string[] = [];
  const logStream = new Writable({
    write(chunk: Buffer | string, _encoding, done) {
      chunks.push(chunk.toString());
      done();
    },
  });

  beforeEach(() => {
    chunks = [];
  });

  function log(): string {
    return chunks.join("");
  }

  it("sends every setup step's stdout to the log, the stream Playwright logs (#192)", async () => {
    const code = await runSetup(
      [step(prints("database created")), step(prints("seed summary"))],
      logStream,
    );
    expect(code).toBe(0);
    expect(log()).toContain("database created\n");
    expect(log()).toContain("seed summary\n");
  });

  it("sends a step's stderr to the log too", async () => {
    expect(await runSetup([step(`${prints("warning")} >&2`)], logStream)).toBe(0);
    expect(log()).toContain("warning\n");
  });

  it("stops at a failing step, names it and runs nothing after it", async () => {
    const fails = "exit 3";
    const code = await runSetup(
      [step(prints("seed summary")), step(fails), step(prints("serving"))],
      logStream,
    );
    expect(code).toBe(3);
    expect(log()).not.toContain("serving");
    expect(log()).toContain(`e2e setup: "${fails}" failed with exit code 3`);
  });

  it("logs the time each setup step took, after the step's output (#248)", async () => {
    expect(await runSetup([step(prints("seed summary"))], logStream)).toBe(0);
    expect(log()).toMatch(/^seed summary\ne2e setup: "printf .*" took \d+\.\d s\.\n$/);
  });

  it("stops a step that outlives its bound, names it, and runs nothing after it (#248)", async () => {
    const hangs = "sleep 60";
    const started = performance.now();
    const code = await runSetup(
      [
        step(prints("database created")),
        { command: hangs, timeoutMs: 500 },
        step(prints("serving")),
      ],
      logStream,
    );
    expect(code).toBe(TIMED_OUT_EXIT_CODE);
    expect(log()).toContain(`e2e setup: "${hangs}" did not finish within 0.5 s`);
    expect(log()).not.toContain("serving");
    // The hanging step is stopped, not waited out.
    expect(performance.now() - started).toBeLessThan(30_000);
  });
});
