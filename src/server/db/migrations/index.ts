// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Explicit migration registry. Static imports keep migrations type-checked and bundle-safe;
// names sort alphabetically, so always prefix new files with the next number.
import type { Migration, MigrationProvider } from "kysely/migration";
import * as m0001 from "./0001_auth.ts";
import * as m0002 from "./0002_user_locale.ts";

export const migrations: Record<string, Migration> = {
  "0001_auth": m0001,
  "0002_user_locale": m0002,
};

export const migrationProvider: MigrationProvider = {
  getMigrations: async () => migrations,
};
