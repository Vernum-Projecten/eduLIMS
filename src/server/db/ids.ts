// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The one id generator of better-auth's rows and the class service (#28): UUIDv7, so ids sort
// by creation time and reveal no count, as PostgreSQL 18's `uuidv7()` does for eduLIMS's own
// tables. Relative imports: `pnpm db:seed` loads auth.ts in plain Node.
import { randomUUIDv7 } from "node:crypto";

/** Returns a new UUIDv7 as text. */
export function newId(): string {
  return randomUUIDv7();
}

/** A UUID in its text form, as the class service checks an id from a request. */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
