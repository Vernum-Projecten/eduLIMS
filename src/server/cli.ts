// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The host CLI of eduLIMS: one entry point for the operator commands, run from the tools image
// (`docker compose run --rm edulims-migrate <command>`, docs/deployment.md) or by a developer
// through the pnpm scripts. Node.js runs it directly by stripping the types, so it needs no
// build, no shell and no message catalogue. Every command validates its arguments, prints ids
// and counts rather than personal data, and exits non-zero on failure. Its access changes and
// failures go to the security log stream (src/server/security-log.ts).
import { adminCommand } from "./admin-grant/command.ts";
import { migrateCommand, type Out } from "./db/migrate.ts";
import { pruneCommand } from "./db/prune.ts";
import { EnvConfigError } from "./env.ts";
import { idpCommand } from "./idp/command.ts";
import { logFailure } from "./security-log.ts";

/** The subcommands of the host CLI. */
export const CLI_COMMANDS = {
  migrate: migrateCommand,
  prune: pruneCommand,
  admin: adminCommand,
  idp: idpCommand,
} as const satisfies Record<string, (args: readonly string[], out: Out) => Promise<number>>;

const USAGE =
  "usage: cli.ts migrate [up|down] | prune | admin grant|revoke <email> [--provider <id>] | " +
  "idp add|list|enable|disable|rekey …";

function isCommand(name: string | undefined): name is keyof typeof CLI_COMMANDS {
  return name !== undefined && Object.hasOwn(CLI_COMMANDS, name);
}

/** Runs the host CLI with `args` (without node and the script); returns the exit code. */
export async function runCli(args: readonly string[], out: Out): Promise<number> {
  const [name, ...rest] = args;
  if (!isCommand(name)) {
    out(USAGE);
    return 2;
  }
  try {
    return await CLI_COMMANDS[name](rest, out);
  } catch (error) {
    reportFailure(name, error, out);
    return 1;
  }
}

/** The security-log event of a host CLI command that threw. */
export const CLI_FAILED_EVENT = "cli_command_failed";

/**
 * Reports a command that threw: a `cli_command_failed` line on the security stream with the
 * command, the invalid variables' names and the cause chain, and a short line for the operator.
 * Neither carries the error's message, which can quote a value or a row (ASVS V16.2.5).
 */
function reportFailure(command: keyof typeof CLI_COMMANDS, error: unknown, out: Out): void {
  const config = error instanceof EnvConfigError;
  logFailure(CLI_FAILED_EVENT, error, {
    actor_type: "system",
    command,
    reason: config ? error.kind : "command_failed",
    variables: config ? error.variables : undefined,
  });
  out(
    config
      ? `failed: invalid environment configuration (${error.variables.join(", ")})`
      : `failed: see the ${CLI_FAILED_EVENT} log line`,
  );
}

if (import.meta.main) {
  process.exitCode = await runCli(process.argv.slice(2), (line) => {
    process.stdout.write(`${line}\n`);
  });
}
