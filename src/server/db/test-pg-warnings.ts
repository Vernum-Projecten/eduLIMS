// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Vitest setup file: a deprecation warning from pg fails the test it appears in, so a query
// issued on a busy client (removed in pg 9) or another pg deprecation never goes unnoticed.
import { afterAll, afterEach } from "vitest";

const seen: string[] = [];

/** Returns whether `warning` is one of pg's deprecations, all of which name `pg@9`. */
export function isPgDeprecation(warning: Error): boolean {
  return warning.name === "DeprecationWarning" && warning.message.includes("pg@9");
}

process.on("warning", (warning) => {
  if (isPgDeprecation(warning)) seen.push(warning.message);
});

function failOnPgDeprecation(): void {
  const messages = seen.splice(0);
  if (messages.length > 0) {
    throw new Error(`pg deprecation warning: ${messages.join("; ")}`);
  }
}

// After hooks run in reverse order, so these run after the test file's own `destroy()`.
afterEach(async () => {
  // process.emitWarning emits on the next tick: let a warning from the last query land first.
  await new Promise((resolve) => setImmediate(resolve));
  failOnPgDeprecation();
});

afterAll(failOnPgDeprecation);
