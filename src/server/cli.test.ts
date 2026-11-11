// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The host CLI dispatcher (src/server/cli.ts): what the tools image runs for the operator.
import { describe, expect, it, vi } from "vitest";
import { CLI_COMMANDS, runCli } from "./cli.ts";

async function run(...args: string[]) {
  const lines: string[] = [];
  const code = await runCli(args, (line) => lines.push(line));
  return { code, lines };
}

describe("runCli", () => {
  it("offers migrate, prune, admin, idp and scim", () => {
    expect(Object.keys(CLI_COMMANDS)).toEqual(["migrate", "prune", "admin", "idp", "scim"]);
  });

  it.each([[[]], [["unknown"]], [["toString"]], [["__proto__"]]])(
    "refuses %j with the usage and exit code 2",
    async (args) => {
      const { code, lines } = await run(...args);
      expect(code).toBe(2);
      expect(lines.join("\n")).toMatch(/^usage: cli\.ts migrate/);
    },
  );

  it("refuses `admin grant` with an invalid email, without printing it (exit 1)", async () => {
    const { code, lines } = await run("admin", "grant", "not-an-email");
    expect(code).toBe(1);
    expect(lines[0]).toBe("refused: invalid email");
    expect(lines.join("\n")).not.toContain("not-an-email");
  });

  it.each([
    [["scim"]],
    [["scim", "token"]],
    [["scim", "token", "create"]],
    [["scim", "token", "print", "campus"]],
    [["scim", "token", "create", "Bad Id"]],
    [["scim", "external-id", "campus"]],
    [["scim", "token", "create", "campus", "extra"]],
  ])("refuses `%j` with the scim usage and exit code 2, before any database", async (args) => {
    const { code, lines } = await run(...args);
    expect(code).toBe(2);
    expect(lines.join("\n")).toMatch(/^usage: scim token create\|rotate\|revoke/);
  });

  it("refuses an invalid provider id and unknown options of `admin grant`", async () => {
    expect((await run("admin", "grant", "a@example.test", "--provider", "Bad Id")).code).toBe(1);
    expect((await run("admin", "grant", "a@example.test", "--force")).code).toBe(2);
    expect((await run("admin", "promote", "a@example.test")).code).toBe(1);
    expect((await run("admin", "grant", "a@example.test", "extra")).code).toBe(2);
  });

  it("refuses a malformed `admin grant --user-id`, and mixing it with an email (#92)", async () => {
    const bad = await run("admin", "grant", "--user-id", "x'; drop");
    expect(bad.code).toBe(1);
    expect(bad.lines[0]).toBe("refused: invalid user-id");
    expect((await run("admin", "grant", "a@example.test", "--user-id", "user-12345")).code).toBe(2);
    expect((await run("admin", "revoke", "--user-id", "user-12345")).code).toBe(2);
    expect(
      (await run("admin", "grant", "--user-id", "user-12345", "--provider", "entra")).code,
    ).toBe(2);
  });

  it("refuses unknown `idp`, `migrate` and `prune` arguments with exit code 2", async () => {
    expect((await run("idp", "explode")).code).toBe(2);
    expect((await run("idp", "list", "extra")).code).toBe(2);
    expect((await run("idp", "add", "--bogus")).code).toBe(2);
    expect((await run("migrate", "sideways")).code).toBe(2);
    expect((await run("prune", "now")).code).toBe(2);
  });

  it("refuses `idp enable` without a valid provider id", async () => {
    const { code, lines } = await run("idp", "enable", "Not A Slug");
    expect(code).toBe(1);
    expect(lines).toEqual(["refused: give a provider id"]);
  });

  it("turns a configuration error into exit code 1 with a message that names no value", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { code } = await run("prune");
    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/DATABASE_URL/));
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
});
