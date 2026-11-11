// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Server-only: the development pages (`/dev/*`) exist only outside production.
import "@tanstack/react-start/server-only";
import { envFields, parseWith } from "./env.ts";

const nodeEnvOnly = envFields.pick({ NODE_ENV: true });

/**
 * Returns whether the development pages may be served: only when `NODE_ENV` is `development`
 * or `test`. An unset `NODE_ENV` counts as production, so the pages stay off by default
 * (OWASP ASVS 5.0 V13.4: no debug functionality in production).
 */
export function devPagesEnabled(source: Record<string, string | undefined>): boolean {
  return parseWith(nodeEnvOnly, source).NODE_ENV !== "production";
}
