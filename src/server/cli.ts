// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The host CLI of eduLIMS: one entry point for the operator commands, run from the tools image
// (`docker compose run --rm edulims-migrate <command>`, docs/deployment.md) or by a developer
// through the pnpm scripts. Node.js runs it directly by stripping the types, so it needs no
// build, no shell and no message catalogue. Every command validates its arguments, prints ids
// and counts rather than personal data, and exits non-zero on failure.
import { adminCommand } from "./admin-grant/command.ts";
import { migrateCommand, type Out } from "./db/migrate.ts";
import { pruneCommand } from "./db/prune.ts";
import { idpCommand } from "./idp/command.ts";
import { scimCommand } from "./scim/command.ts";

/** The subcommands of the host CLI. */
export const CLI_COMMANDS = {
  migrate: migrateCommand,
  prune: pruneCommand,
  admin: adminCommand,
  idp: idpCommand,
  scim: scimCommand,
} as const satisfies Record<string, (args: readonly string[], out: Out) => Promise<number>>;

const USAGE =
  "usage: cli.ts migrate [up|down] | prune | admin grant|revoke <email> [--provider <id>] | " +
  "idp add|list|enable|disable|rekey … | scim token create|rotate|revoke <provider-id> | " +
  "scim external-id <provider-id> <claim>|--account-key";

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
    // The message of a configuration error names variables, never their values.
    console.error(error instanceof Error ? error.message : "command failed");
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await runCli(process.argv.slice(2), (line) => {
    process.stdout.write(`${line}\n`);
  });
}
