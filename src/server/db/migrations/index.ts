// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Explicit migration registry. Static imports keep migrations type-checked and bundle-safe;
// names sort alphabetically, so always prefix new files with the next number.
import type { Migration, MigrationProvider } from "kysely/migration";
import * as m0001 from "./0001_auth.ts";
import * as m0002 from "./0002_user_locale.ts";
import * as m0003 from "./0003_user_last_portal.ts";
import * as m0004 from "./0004_user_role_check.ts";
import * as m0005 from "./0005_audit_event.ts";
import * as m0006 from "./0006_session_absolute_lifetime.ts";
import * as m0007 from "./0007_user_role_source.ts";
import * as m0008 from "./0008_identity_provider.ts";
import * as m0009 from "./0009_analyser.ts";
import * as m0010 from "./0010_integration_check.ts";
import * as m0011 from "./0011_audit_event_indexes.ts";
import * as m0012 from "./0012_classes.ts";
import * as m0015 from "./0015_class_join_code.ts";

export const migrations: Record<string, Migration> = {
  "0001_auth": m0001,
  "0002_user_locale": m0002,
  "0003_user_last_portal": m0003,
  "0004_user_role_check": m0004,
  "0005_audit_event": m0005,
  "0006_session_absolute_lifetime": m0006,
  "0007_user_role_source": m0007,
  "0008_identity_provider": m0008,
  "0009_analyser": m0009,
  "0010_integration_check": m0010,
  "0011_audit_event_indexes": m0011,
  "0012_classes": m0012,
  "0015_class_join_code": m0015,
};

export const migrationProvider: MigrationProvider = {
  getMigrations: async () => migrations,
};
