// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The SQL side of `isAsciiEmail` (src/lib/simulations.ts). Relative imports and no server-only
// marker: the sign-in link loads the removals in plain Node.
import { type RawBuilder, sql } from "kysely";

/**
 * Returns a condition that holds when the stored `user.email` is printable ASCII only. A stored
 * address with a letter that folds onto ASCII when lower-cased (U+212A KELVIN SIGN becomes `k`)
 * then never matches an address a teacher typed (#311, ASVS V6.8.1).
 */
export function storedEmailIsAscii(): RawBuilder<boolean> {
  return sql<boolean>`${sql.ref("user.email")} ~ '^[!-~]+$'`;
}
