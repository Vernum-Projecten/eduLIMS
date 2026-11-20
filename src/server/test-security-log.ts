// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Vitest setup file: during a test run the security log stream writes nowhere instead of stdout,
// so `pnpm test` prints no JSON lines between its results. A test that asserts the stream captures
// it with its own `setSecurityLogWriter`, whose restore returns to this writer. Each test also
// gets a body refusal log of its own: no trusted proxy and an empty window, so no refusal of one
// test hides the log line of another.
import { afterEach, beforeEach } from "vitest";
import { setBodyRefusalLogDeps } from "./body-refusal-log.ts";
import { RefusalDeduper } from "./refusal-deduper.ts";
import { setSecurityLogWriter } from "./security-log.ts";

setSecurityLogWriter(() => undefined);

let restoreBodyRefusalLog: (() => void) | undefined;

beforeEach(() => {
  restoreBodyRefusalLog = setBodyRefusalLogDeps({
    trustedProxies: () => [],
    deduper: new RefusalDeduper(),
  });
});

afterEach(() => {
  restoreBodyRefusalLog?.();
  restoreBodyRefusalLog = undefined;
});
