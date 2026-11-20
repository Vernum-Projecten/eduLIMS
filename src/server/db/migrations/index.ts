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
import * as m0012 from "./0012_simulations_and_labs.ts";
import * as m0013 from "./0013_scim.ts";
import * as m0014 from "./0014_lab_join_code.ts";
import * as m0015 from "./0015_integration_check_steps.ts";
import * as m0016 from "./0016_test_catalogue.ts";
import * as m0017 from "./0017_catalogue_follow_ups.ts";
import * as m0018 from "./0018_simulation_state_and_correct_values.ts";
import * as m0019 from "./0019_lab_logos.ts";
import * as m0020 from "./0020_patients_requests_samples.ts";
import * as m0021 from "./0021_lab_tolerances.ts";
import * as m0022 from "./0022_patient_ehr.ts";
import * as m0023 from "./0023_measurements_and_release.ts";
import * as m0024 from "./0024_result_ehr_writes.ts";
import * as m0025 from "./0025_result_ehr_write_lease.ts";
import * as m0026 from "./0026_one_active_simulation_per_student.ts";
import * as m0027 from "./0027_gen5_uploads.ts";
import * as m0028 from "./0028_catalogue_unit_ucum.ts";
import * as m0030 from "./0030_one_running_simulation.ts";

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
  "0012_simulations_and_labs": m0012,
  "0013_scim": m0013,
  "0014_lab_join_code": m0014,
  "0015_integration_check_steps": m0015,
  "0016_test_catalogue": m0016,
  "0017_catalogue_follow_ups": m0017,
  "0018_simulation_state_and_correct_values": m0018,
  "0019_lab_logos": m0019,
  "0020_patients_requests_samples": m0020,
  "0021_lab_tolerances": m0021,
  "0022_patient_ehr": m0022,
  "0023_measurements_and_release": m0023,
  "0024_result_ehr_writes": m0024,
  "0025_result_ehr_write_lease": m0025,
  "0026_one_active_simulation_per_student": m0026,
  "0027_gen5_uploads": m0027,
  "0028_catalogue_unit_ucum": m0028,
  "0030_one_running_simulation": m0030,
};

export const migrationProvider: MigrationProvider = {
  getMigrations: async () => migrations,
};
