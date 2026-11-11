// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Vitest setup file: during a test run the security log stream writes nowhere instead of stdout,
// so `pnpm test` prints no JSON lines between its results. A test that asserts the stream captures
// it with its own `setSecurityLogWriter`, whose restore returns to this writer.
import { setSecurityLogWriter } from "./security-log.ts";

setSecurityLogWriter(() => undefined);
