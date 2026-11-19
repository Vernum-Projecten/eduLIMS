// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The pnpm version is pinned in three places: package.json (`packageManager`
// and `devEngines`), the integrity table of scripts/release/install-pnpm.sh,
// and the build stage of docker/Dockerfile. They drifted once and every image
// build failed, so this test holds them together.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");

/** Reads a repository file as text. */
function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

/** Returns the first capture group of `pattern` in `text`, or fails the test. */
function capture(text: string, pattern: RegExp, what: string): string {
  const value = pattern.exec(text)?.[1];
  if (value === undefined) {
    throw new Error(`no ${what} found`);
  }
  return value;
}

describe("the pnpm pins", () => {
  const manifest: unknown = JSON.parse(read("package.json"));
  const packageManager = capture(
    JSON.stringify(manifest),
    /"packageManager":"pnpm@([^"]+)"/,
    "packageManager",
  );
  const devEngines = capture(
    JSON.stringify(manifest),
    /"packageManager":\{"name":"pnpm","version":"([^"]+)"/,
    "devEngines.packageManager",
  );
  const dockerfile = read("docker/Dockerfile");
  const dockerVersion = capture(dockerfile, /^ARG PNPM_VERSION=(\S+)$/m, "PNPM_VERSION");
  const dockerIntegrity = capture(dockerfile, /^ARG PNPM_INTEGRITY=(\S+)$/m, "PNPM_INTEGRITY");
  const table = read("scripts/release/install-pnpm.sh");

  it("name one version in package.json and the Dockerfile", () => {
    expect(devEngines).toBe(packageManager);
    expect(dockerVersion).toBe(packageManager);
  });

  it("give the Dockerfile the integrity the install script pins for that version", () => {
    const row = capture(
      table,
      new RegExp(`^${packageManager.replaceAll(".", "\\.")}\\t(sha512-[A-Za-z0-9+/]+=*)`, "m"),
      `integrity row for pnpm ${packageManager}`,
    );
    expect(dockerIntegrity).toBe(row);
  });
});
