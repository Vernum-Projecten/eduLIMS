// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The e2e web server command (#192): Playwright spawns it in a shell and forwards stderr only,
// so these cases spawn it the same way and read what each stream carries.
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { setupThenServe } from "../e2e/web-server-command.ts";

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

/** A step that writes `text` to stdout, as the seed writes its summary. */
function prints(text: string): string {
  return `node -e "process.stdout.write('${text}\\n')"`;
}

describe("the e2e web server command (#192)", () => {
  it("sends every setup step's stdout to stderr, the stream Playwright logs", async () => {
    const result = await run(
      setupThenServe([prints("database created"), prints("seed summary")], prints("serving")),
    );
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("database created\n");
    expect(result.stderr).toContain("seed summary\n");
    expect(result.stdout).not.toContain("seed summary");
  });

  it("keeps the server's own stdout on stdout, out of the run log", async () => {
    const result = await run(setupThenServe([prints("seed summary")], prints("security event")));
    expect(result.stdout).toBe("security event\n");
    expect(result.stderr).not.toContain("security event");
  });

  it("starts no server when a setup step fails", async () => {
    const result = await run(
      setupThenServe([prints("seed summary"), `node -e "process.exit(3)"`], prints("serving")),
    );
    expect(result.code).toBe(3);
    expect(result.stdout).not.toContain("serving");
  });

  it("refuses an empty setup", () => {
    expect(() => setupThenServe([], "pnpm start")).toThrow(Error);
  });
});
