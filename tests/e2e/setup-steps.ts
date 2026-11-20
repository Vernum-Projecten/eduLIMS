// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The command-line entry of the e2e web server's setup (#248): runs on plain Node (type
// stripping) as `node tests/e2e/setup-steps.ts <steps>`, where `<steps>` is the base64url JSON
// that web-server-command.ts encodes. setup-runner.ts runs the steps, with their output on stderr.
import { runSetup } from "./setup-runner.ts";
import { decodeSetupSteps } from "./web-server-command.ts";

const encoded = process.argv[2];
if (encoded === undefined) throw new Error("Usage: setup-steps.ts <base64url JSON of the steps>");
// The exit code, not process.exit, so the log on stderr is written out before the process ends.
process.exitCode = await runSetup(decodeSetupSteps(encoded), process.stderr);
