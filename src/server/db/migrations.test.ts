// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { getMigrations } from "better-auth/db/migration";
import { type Kysely, sql } from "kysely";
import { NO_MIGRATIONS } from "kysely/migration";
import { afterEach, describe, expect, it } from "vitest";
import { isLabNumber, withCheckDigit } from "../../lib/lab-number.ts";
import { createAuth } from "../auth.ts";
import { parseEnv } from "../env.ts";
import { VALID_ENV } from "../test-env.ts";
import { createMigrator } from "./index.ts";
import { migrations } from "./migrations/index.ts";
import type { DB } from "./schema.gen.ts";
import { createTestDb } from "./test-db.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

describe("migrations", () => {
  it("match the schema better-auth expects (no drift)", async () => {
    db = await createTestDb();
    const auth = createAuth(parseEnv(VALID_ENV), { db, type: "postgres" });
    // The migration planner reads a Kysely database, not the encrypting adapter around it.
    const plan = await getMigrations({ ...auth.options, database: { db, type: "postgres" } });
    // On failure this prints the SQL to add as a new migration.
    const sql = await plan.compileMigrations();
    expect(sql.trim(), sql).toBe(";");
    expect(plan.schemaProblems).toEqual([]);
  });

  it("migrate down to an empty schema and back up again", async () => {
    db = await createTestDb();
    const migrator = createMigrator(db);
    const down = await migrator.migrateTo(NO_MIGRATIONS);
    expect(down.error).toBeUndefined();
    const tables = await db.introspection.getTables();
    expect(tables.map((t) => t.name)).toEqual([]);
    const up = await migrator.migrateToLatest();
    expect(up.results?.map((r) => r.status)).toEqual(Object.keys(migrations).map(() => "Success"));
  });

  it("0004_user_role_check reverts to no check and refuses a conflicting role set", async () => {
    db = await createTestDb();
    const insert = (database: Kysely<DB>, role: string) =>
      database
        .insertInto("user")
        .values({
          id: `u-${role}`,
          name: "R",
          email: `${role}@example.test`,
          emailVerified: true,
          role,
        })
        .execute();
    const migrator = createMigrator(db);
    const down = await migrator.migrateTo("0003_user_last_portal");
    expect(down.results?.map((r) => [r.migrationName, r.status])).toEqual([
      ["0028_catalogue_unit_ucum", "Success"],
      ["0026_one_active_simulation_per_student", "Success"],
      ["0025_result_ehr_write_lease", "Success"],
      ["0024_result_ehr_writes", "Success"],
      ["0023_measurements_and_release", "Success"],
      ["0022_patient_ehr", "Success"],
      ["0021_lab_tolerances", "Success"],
      ["0020_patients_requests_samples", "Success"],
      ["0019_lab_logos", "Success"],
      ["0018_simulation_state_and_correct_values", "Success"],
      ["0017_catalogue_follow_ups", "Success"],
      ["0016_test_catalogue", "Success"],
      ["0015_integration_check_steps", "Success"],
      ["0014_lab_join_code", "Success"],
      ["0013_scim", "Success"],
      ["0012_simulations_and_labs", "Success"],
      ["0011_audit_event_indexes", "Success"],
      ["0010_integration_check", "Success"],
      ["0009_analyser", "Success"],
      ["0008_identity_provider", "Success"],
      ["0007_user_role_source", "Success"],
      ["0006_session_absolute_lifetime", "Success"],
      ["0005_audit_event", "Success"],
      ["0004_user_role_check", "Success"],
    ]);
    await expect(insert(db, "student,admin")).resolves.toBeDefined();
    await db.deleteFrom("user").where("role", "=", "student,admin").execute();
    const up = await migrator.migrateToLatest();
    expect(up.error).toBeUndefined();
    // Last: a refused statement aborts the test transaction.
    await expect(insert(db, "student,admin")).rejects.toThrow(/check constraint/);
  });

  it("0003_user_last_portal reverts to a user table without the last_portal column", async () => {
    db = await createTestDb();
    const migrator = createMigrator(db);
    const down = await migrator.migrateTo("0002_user_locale");
    expect(down.results?.map((r) => [r.migrationName, r.status])).toEqual([
      ["0028_catalogue_unit_ucum", "Success"],
      ["0026_one_active_simulation_per_student", "Success"],
      ["0025_result_ehr_write_lease", "Success"],
      ["0024_result_ehr_writes", "Success"],
      ["0023_measurements_and_release", "Success"],
      ["0022_patient_ehr", "Success"],
      ["0021_lab_tolerances", "Success"],
      ["0020_patients_requests_samples", "Success"],
      ["0019_lab_logos", "Success"],
      ["0018_simulation_state_and_correct_values", "Success"],
      ["0017_catalogue_follow_ups", "Success"],
      ["0016_test_catalogue", "Success"],
      ["0015_integration_check_steps", "Success"],
      ["0014_lab_join_code", "Success"],
      ["0013_scim", "Success"],
      ["0012_simulations_and_labs", "Success"],
      ["0011_audit_event_indexes", "Success"],
      ["0010_integration_check", "Success"],
      ["0009_analyser", "Success"],
      ["0008_identity_provider", "Success"],
      ["0007_user_role_source", "Success"],
      ["0006_session_absolute_lifetime", "Success"],
      ["0005_audit_event", "Success"],
      ["0004_user_role_check", "Success"],
      ["0003_user_last_portal", "Success"],
    ]);
    const user = (await db.introspection.getTables()).find((t) => t.name === "user");
    expect(user?.columns.map((c) => c.name)).not.toContain("last_portal");
    expect(user?.columns.map((c) => c.name)).toContain("locale");
    const up = await migrator.migrateToLatest();
    expect(up.error).toBeUndefined();
  });

  it("0002_user_locale reverts to a user table without the locale column", async () => {
    db = await createTestDb();
    const migrator = createMigrator(db);
    const down = await migrator.migrateTo("0001_auth");
    expect(down.results?.map((r) => [r.migrationName, r.status])).toEqual([
      ["0028_catalogue_unit_ucum", "Success"],
      ["0026_one_active_simulation_per_student", "Success"],
      ["0025_result_ehr_write_lease", "Success"],
      ["0024_result_ehr_writes", "Success"],
      ["0023_measurements_and_release", "Success"],
      ["0022_patient_ehr", "Success"],
      ["0021_lab_tolerances", "Success"],
      ["0020_patients_requests_samples", "Success"],
      ["0019_lab_logos", "Success"],
      ["0018_simulation_state_and_correct_values", "Success"],
      ["0017_catalogue_follow_ups", "Success"],
      ["0016_test_catalogue", "Success"],
      ["0015_integration_check_steps", "Success"],
      ["0014_lab_join_code", "Success"],
      ["0013_scim", "Success"],
      ["0012_simulations_and_labs", "Success"],
      ["0011_audit_event_indexes", "Success"],
      ["0010_integration_check", "Success"],
      ["0009_analyser", "Success"],
      ["0008_identity_provider", "Success"],
      ["0007_user_role_source", "Success"],
      ["0006_session_absolute_lifetime", "Success"],
      ["0005_audit_event", "Success"],
      ["0004_user_role_check", "Success"],
      ["0003_user_last_portal", "Success"],
      ["0002_user_locale", "Success"],
    ]);
    const user = (await db.introspection.getTables()).find((t) => t.name === "user");
    expect(user?.columns.map((c) => c.name)).not.toContain("locale");
    const up = await migrator.migrateToLatest();
    expect(up.error).toBeUndefined();
  });

  it("0006_session_absolute_lifetime caps a session at 24 hours after sign-in, and reverts", async () => {
    db = await createTestDb();
    await db
      .insertInto("user")
      .values({
        id: "u-s",
        name: "S",
        email: "s@example.test",
        emailVerified: true,
        role: "student",
      })
      .execute();
    const insertSession = (database: Kysely<DB>, id: string) =>
      database
        .insertInto("session")
        .values({
          id,
          token: `token-${id}`,
          userId: "u-s",
          createdAt: new Date("2026-11-11T08:00:00Z"),
          updatedAt: new Date("2026-11-11T08:00:00Z"),
          expiresAt: new Date("2026-11-20T08:00:00Z"),
        })
        .returning("expiresAt")
        .executeTakeFirstOrThrow();
    expect((await insertSession(db, "capped")).expiresAt).toEqual(new Date("2026-11-12T08:00:00Z"));
    const migrator = createMigrator(db);
    const down = await migrator.migrateTo("0005_audit_event");
    expect(down.results?.map((r) => [r.migrationName, r.status])).toEqual([
      ["0028_catalogue_unit_ucum", "Success"],
      ["0026_one_active_simulation_per_student", "Success"],
      ["0025_result_ehr_write_lease", "Success"],
      ["0024_result_ehr_writes", "Success"],
      ["0023_measurements_and_release", "Success"],
      ["0022_patient_ehr", "Success"],
      ["0021_lab_tolerances", "Success"],
      ["0020_patients_requests_samples", "Success"],
      ["0019_lab_logos", "Success"],
      ["0018_simulation_state_and_correct_values", "Success"],
      ["0017_catalogue_follow_ups", "Success"],
      ["0016_test_catalogue", "Success"],
      ["0015_integration_check_steps", "Success"],
      ["0014_lab_join_code", "Success"],
      ["0013_scim", "Success"],
      ["0012_simulations_and_labs", "Success"],
      ["0011_audit_event_indexes", "Success"],
      ["0010_integration_check", "Success"],
      ["0009_analyser", "Success"],
      ["0008_identity_provider", "Success"],
      ["0007_user_role_source", "Success"],
      ["0006_session_absolute_lifetime", "Success"],
    ]);
    expect((await insertSession(db, "uncapped")).expiresAt).toEqual(
      new Date("2026-11-20T08:00:00Z"),
    );
    expect((await migrator.migrateToLatest()).error).toBeUndefined();
  });

  it("0008_identity_provider refuses a reserved or malformed provider id and reverts", async () => {
    db = await createTestDb();
    const insert = (database: Kysely<DB>, providerId: string) =>
      database
        .insertInto("ssoProvider")
        .values({
          id: `p-${providerId}`,
          issuer: "https://idp.example",
          oidcConfig: "{}",
          providerId,
          domain: "x.provider.invalid",
        })
        .execute();
    const migrator = createMigrator(db);
    const down = await migrator.migrateTo("0007_user_role_source");
    expect(down.results?.map((r) => [r.migrationName, r.status])).toEqual([
      ["0028_catalogue_unit_ucum", "Success"],
      ["0026_one_active_simulation_per_student", "Success"],
      ["0025_result_ehr_write_lease", "Success"],
      ["0024_result_ehr_writes", "Success"],
      ["0023_measurements_and_release", "Success"],
      ["0022_patient_ehr", "Success"],
      ["0021_lab_tolerances", "Success"],
      ["0020_patients_requests_samples", "Success"],
      ["0019_lab_logos", "Success"],
      ["0018_simulation_state_and_correct_values", "Success"],
      ["0017_catalogue_follow_ups", "Success"],
      ["0016_test_catalogue", "Success"],
      ["0015_integration_check_steps", "Success"],
      ["0014_lab_join_code", "Success"],
      ["0013_scim", "Success"],
      ["0012_simulations_and_labs", "Success"],
      ["0011_audit_event_indexes", "Success"],
      ["0010_integration_check", "Success"],
      ["0009_analyser", "Success"],
      ["0008_identity_provider", "Success"],
    ]);
    const tables = (await db.introspection.getTables()).map((t) => t.name);
    expect(tables).not.toContain("ssoProvider");
    expect(tables).not.toContain("identity_provider");
    const up = await migrator.migrateToLatest();
    expect(up.error).toBeUndefined();
    // Last: a refused statement aborts the test transaction.
    await expect(insert(db, "Not A Slug")).rejects.toThrow(/check constraint/);
  });

  it("0011_audit_event_indexes orders the activity log by time and id, and reverts (#36)", async () => {
    db = await createTestDb();
    const indexes = async (database: Kysely<DB>) => {
      const rows = await sql<{ indexname: string; indexdef: string }>`
        select indexname, indexdef from pg_indexes
        where tablename = 'audit_event' and indexname <> 'audit_event_pkey'
        order by indexname`.execute(database);
      return rows.rows.map((row) => `${row.indexname}: ${row.indexdef.replace(/^.* USING /, "")}`);
    };
    expect(await indexes(db)).toEqual([
      "audit_event_action_occurred_at_idx: btree (action, occurred_at)",
      "audit_event_actor_id_occurred_at_idx: btree (actor_id, occurred_at)",
      "audit_event_occurred_at_id_idx: btree (occurred_at, id)",
      "audit_event_target_occurred_at_idx: btree (target_type, target_id, occurred_at, id)",
    ]);
    const migrator = createMigrator(db);
    const down = await migrator.migrateTo("0010_integration_check");
    expect(down.results?.map((r) => [r.migrationName, r.status])).toEqual([
      ["0028_catalogue_unit_ucum", "Success"],
      ["0026_one_active_simulation_per_student", "Success"],
      ["0025_result_ehr_write_lease", "Success"],
      ["0024_result_ehr_writes", "Success"],
      ["0023_measurements_and_release", "Success"],
      ["0022_patient_ehr", "Success"],
      ["0021_lab_tolerances", "Success"],
      ["0020_patients_requests_samples", "Success"],
      ["0019_lab_logos", "Success"],
      ["0018_simulation_state_and_correct_values", "Success"],
      ["0017_catalogue_follow_ups", "Success"],
      ["0016_test_catalogue", "Success"],
      ["0015_integration_check_steps", "Success"],
      ["0014_lab_join_code", "Success"],
      ["0013_scim", "Success"],
      ["0012_simulations_and_labs", "Success"],
      ["0011_audit_event_indexes", "Success"],
    ]);
    expect(await indexes(db)).toEqual([
      "audit_event_action_occurred_at_idx: btree (action, occurred_at)",
      "audit_event_actor_id_occurred_at_idx: btree (actor_id, occurred_at)",
      "audit_event_occurred_at_idx: btree (occurred_at DESC)",
      "audit_event_target_idx: btree (target_type, target_id)",
    ]);
    expect((await migrator.migrateToLatest()).error).toBeUndefined();
  });

  it("0013_scim backfills role_channel 'claim' for a provider's role set, and reverts", async () => {
    const database = await createTestDb();
    db = database;
    const migrator = createMigrator(database);
    // The migration below 0013 is 0012_simulations_and_labs; 0015, 0014 and then 0013 revert.
    const down = await migrator.migrateTo("0012_simulations_and_labs");
    expect(down.results?.map((r) => [r.migrationName, r.status])).toEqual([
      ["0028_catalogue_unit_ucum", "Success"],
      ["0026_one_active_simulation_per_student", "Success"],
      ["0025_result_ehr_write_lease", "Success"],
      ["0024_result_ehr_writes", "Success"],
      ["0023_measurements_and_release", "Success"],
      ["0022_patient_ehr", "Success"],
      ["0021_lab_tolerances", "Success"],
      ["0020_patients_requests_samples", "Success"],
      ["0019_lab_logos", "Success"],
      ["0018_simulation_state_and_correct_values", "Success"],
      ["0017_catalogue_follow_ups", "Success"],
      ["0016_test_catalogue", "Success"],
      ["0015_integration_check_steps", "Success"],
      ["0014_lab_join_code", "Success"],
      ["0013_scim", "Success"],
    ]);
    const user = (id: string, roleSource: string) =>
      sql`insert into "user" (id, name, email, "emailVerified", role, role_source)
          values (${id}, 'R', ${`${id}@example.test`}, true, 'teacher', ${roleSource})`.execute(
        database,
      );
    await user("u-claim", "keycloak");
    await user("u-local", "local");
    const up = await migrator.migrateToLatest();
    expect(up.error).toBeUndefined();
    const rows = await db.selectFrom("user").select(["id", "role_channel"]).orderBy("id").execute();
    expect(rows).toEqual([
      { id: "u-claim", role_channel: "claim" },
      { id: "u-local", role_channel: "local" },
    ]);
  });

  it("0013_scim allows only an immutable external-id claim (finding 7)", async () => {
    const database = await createTestDb();
    db = database;
    await database
      .insertInto("ssoProvider")
      .values({
        id: "p-campus",
        issuer: "https://idp.example",
        oidcConfig: "{}",
        providerId: "campus",
        domain: "x.provider.invalid",
      })
      .execute();
    const provider = (claim: string) =>
      database
        .insertInto("identity_provider")
        .values({
          provider_id: "campus",
          protocol: "oidc",
          label_en: "Campus",
          label_nl: "Campus",
          role_claim: "roles",
          scim_external_id_claim: claim,
        })
        .execute();
    await expect(provider("email")).rejects.toThrow(/check constraint/);
  });

  it("0013_scim keeps one account per provider and directory id (finding 8)", async () => {
    const database = await createTestDb();
    db = database;
    const now = new Date();
    await database
      .insertInto("user")
      .values([
        { id: "u1", name: "A", email: "a@example.test", emailVerified: true },
        { id: "u2", name: "B", email: "b@example.test", emailVerified: true },
      ])
      .execute();
    const account = (id: string, userId: string, directoryId: string | null) =>
      database
        .insertInto("account")
        .values({
          id,
          accountId: id,
          providerId: "campus",
          userId,
          createdAt: now,
          updatedAt: now,
          directory_id: directoryId,
        })
        .execute();
    await account("a1", "u1", null);
    await account("a2", "u2", null);
    await account("a3", "u1", "oid-1");
    await expect(account("a4", "u2", "oid-1")).rejects.toThrow(/duplicate key/);
  });

  it("0015_integration_check_steps upgrades a database that holds checks from before the steps", async () => {
    const database = await createTestDb();
    db = database;
    const migrator = createMigrator(database);
    const down = await migrator.migrateTo("0014_lab_join_code");
    expect(down.error).toBeUndefined();
    await sql`insert into integration_checks (integration, state, checked_at, last_success_at, response_time_ms, error_class)
        values ('ferroehr', 'available', now(), now(), 12, null), ('ferrobridge', 'unavailable', now(), null, null, 'unreachable')`.execute(
      database,
    );
    expect((await migrator.migrateToLatest()).error).toBeUndefined();
    const rows = await sql<{
      n: string;
    }>`select count(*)::text as n from integration_checks`.execute(database);
    expect(rows.rows).toEqual([{ n: "0" }]);
  });

  it("0015_integration_check_steps adds the steps and not ready, and reverts (#227)", async () => {
    const database = await createTestDb();
    db = database;
    const migrator = createMigrator(database);
    // Each statement runs in its own savepoint, so an expected refusal leaves the test usable.
    const inSavepoint = (query: ReturnType<typeof sql>) =>
      database.transaction().execute((trx) => query.execute(trx));
    const notReady = () =>
      inSavepoint(sql`insert into integration_checks (integration, state, checked_at, error_class)
          values ('ferrobridge', 'not_ready', now(), 'readiness_down')`);
    const down = await migrator.migrateTo("0014_lab_join_code");
    expect(down.results?.map((r) => [r.migrationName, r.status])).toEqual([
      ["0028_catalogue_unit_ucum", "Success"],
      ["0026_one_active_simulation_per_student", "Success"],
      ["0025_result_ehr_write_lease", "Success"],
      ["0024_result_ehr_writes", "Success"],
      ["0023_measurements_and_release", "Success"],
      ["0022_patient_ehr", "Success"],
      ["0021_lab_tolerances", "Success"],
      ["0020_patients_requests_samples", "Success"],
      ["0019_lab_logos", "Success"],
      ["0018_simulation_state_and_correct_values", "Success"],
      ["0017_catalogue_follow_ups", "Success"],
      ["0016_test_catalogue", "Success"],
      ["0015_integration_check_steps", "Success"],
    ]);
    await expect(notReady()).rejects.toThrow(/integration_checks_(state|error_class)/);
    await expect(inSavepoint(sql`select reachable from integration_checks`)).rejects.toThrow(
      /column "reachable" does not exist/,
    );
    expect((await migrator.migrateToLatest()).error).toBeUndefined();
    await notReady();
    const row = await database
      .selectFrom("integration_checks")
      .select(["state", "failing_indicators"])
      .executeTakeFirst();
    expect(row).toEqual({ state: "not_ready", failing_indicators: null });
  });

  it("0016_test_catalogue keeps active names unique case-insensitively, and reverts (D9, #266)", async () => {
    const database = await createTestDb();
    db = database;
    const migrator = createMigrator(database);
    const inSavepoint = (query: ReturnType<typeof sql>) =>
      database.transaction().execute((trx) => query.execute(trx));
    const insert = (name: string, retired: boolean) =>
      inSavepoint(sql`insert into catalogue_tests (name, unit, material, source, retired_at)
          values (${name}, 'mmol/L', 'plasma', 'manual', ${retired ? sql`now()` : sql`null`})`);
    await insert("Glucose", true);
    await insert("Glucose", false);
    await expect(insert("GLUCOSE", false)).rejects.toThrow(/catalogue_tests_active_name_key/);
    const down = await migrator.migrateTo("0015_integration_check_steps");
    expect(down.results?.map((r) => [r.migrationName, r.status])).toEqual([
      ["0028_catalogue_unit_ucum", "Success"],
      ["0026_one_active_simulation_per_student", "Success"],
      ["0025_result_ehr_write_lease", "Success"],
      ["0024_result_ehr_writes", "Success"],
      ["0023_measurements_and_release", "Success"],
      ["0022_patient_ehr", "Success"],
      ["0021_lab_tolerances", "Success"],
      ["0020_patients_requests_samples", "Success"],
      ["0019_lab_logos", "Success"],
      ["0018_simulation_state_and_correct_values", "Success"],
      ["0017_catalogue_follow_ups", "Success"],
      ["0016_test_catalogue", "Success"],
    ]);
    await expect(inSavepoint(sql`select id from catalogue_tests`)).rejects.toThrow(
      /relation "catalogue_tests" does not exist/,
    );
    expect((await migrator.migrateToLatest()).error).toBeUndefined();
  });

  it("0017_catalogue_follow_ups allows no unit and one active Afinion 2 test per analyte, and reverts (#266)", async () => {
    const database = await createTestDb();
    db = database;
    const migrator = createMigrator(database);
    const inSavepoint = (query: ReturnType<typeof sql>) =>
      database.transaction().execute((trx) => query.execute(trx));
    const afinion = (name: string, analyte: string, retired: boolean) =>
      inSavepoint(sql`insert into catalogue_tests (name, unit, material, source, afinion_analyte, retired_at)
          values (${name}, null, 'blood', 'afinion', ${analyte}, ${retired ? sql`now()` : sql`null`})`);
    await afinion("Chol/HDL", "Chol/HDL", true);
    await afinion("Chol/HDL ratio", "Chol/HDL", false);
    await expect(afinion("Cholesterol ratio", "CHOL/HDL", false)).rejects.toThrow(
      /catalogue_tests_active_analyte_key/,
    );
    await expect(
      inSavepoint(sql`insert into catalogue_tests (name, unit, material, source)
          values ('Empty unit', '', 'blood', 'manual')`),
    ).rejects.toThrow(/catalogue_tests_unit/);
    await expect(
      inSavepoint(sql`insert into catalogue_tests (name, unit, material, source, afinion_analyte)
          values ('Pipe', 'mg/L', 'blood', 'afinion', 'CR|P')`),
    ).rejects.toThrow(/catalogue_tests_afinion_analyte/);
    await expect(
      inSavepoint(sql`insert into catalogue_tests (name, unit, material, source, afinion_analyte)
          values ('Accent', 'mg/L', 'blood', 'afinion', 'Créat')`),
    ).rejects.toThrow(/catalogue_tests_afinion_analyte_ascii/);
    // A test without a unit blocks the revert, and 0017 stays applied with its index and CHECK.
    const blocked = await migrator.migrateTo("0016_test_catalogue");
    expect(blocked.error).toBeDefined();
    const applied = await sql<{ name: string }>`select name from kysely_migration
        where name = '0017_catalogue_follow_ups'`.execute(database);
    expect(applied.rows).toEqual([{ name: "0017_catalogue_follow_ups" }]);
    await expect(afinion("Chol ratio", "chol/hdl", false)).rejects.toThrow(
      /catalogue_tests_active_analyte_key/,
    );
    await expect(
      inSavepoint(sql`insert into catalogue_tests (name, unit, material, source)
          values ('Empty unit again', '', 'blood', 'manual')`),
    ).rejects.toThrow(/catalogue_tests_unit/);
    await inSavepoint(sql`delete from catalogue_tests`);
    const down = await migrator.migrateTo("0016_test_catalogue");
    expect(down.results?.map((r) => [r.migrationName, r.status])).toEqual([
      ["0028_catalogue_unit_ucum", "Success"],
      ["0026_one_active_simulation_per_student", "Success"],
      ["0025_result_ehr_write_lease", "Success"],
      ["0024_result_ehr_writes", "Success"],
      ["0023_measurements_and_release", "Success"],
      ["0022_patient_ehr", "Success"],
      ["0021_lab_tolerances", "Success"],
      ["0020_patients_requests_samples", "Success"],
      ["0019_lab_logos", "Success"],
      ["0018_simulation_state_and_correct_values", "Success"],
      ["0017_catalogue_follow_ups", "Success"],
    ]);
    await expect(
      inSavepoint(sql`insert into catalogue_tests (name, unit, material, source)
          values ('No unit', null, 'blood', 'manual')`),
    ).rejects.toThrow(/null value in column "unit"/);
    expect((await migrator.migrateToLatest()).error).toBeUndefined();
  });

  it("0018_simulation_state_and_correct_values holds its rules and reverts (#267)", async () => {
    const database = await createTestDb();
    db = database;
    const migrator = createMigrator(database);
    const inSavepoint = (query: ReturnType<typeof sql>) =>
      database.transaction().execute((trx) => query.execute(trx));
    const simulation = await sql<{ id: string; state: string }>`
        insert into simulations (name) values ('Migration run') returning id, state`.execute(
      database,
    );
    const [row] = simulation.rows;
    if (!row) throw new Error("no simulation");
    expect(row.state).toBe("prepared");
    const test = await sql<{
      id: string;
    }>`insert into catalogue_tests (name, unit, material, source)
        values ('Migration test', 'mmol/L', 'plasma', 'manual') returning id`.execute(database);
    const testId = test.rows[0]?.id ?? "";
    const value = (sample: string, number: string) =>
      inSavepoint(sql`insert into correct_values (simulation_id, test_id, sample_number, value)
          values (${row.id}, ${testId}, ${sample}, ${number}::numeric)`);
    await value("S-1", "5.20");
    await expect(value("s-1", "6")).rejects.toThrow(/correct_values_key/);
    await expect(value(" S-2", "1")).rejects.toThrow(/correct_values_sample_number/);
    await expect(value("S-3", "1.1234567")).rejects.toThrow(/correct_values_value/);
    await expect(value("S-4", "1000000000")).rejects.toThrow(/correct_values_value/);
    const stored = await sql<{ value: string }>`select value::text from correct_values`.execute(
      database,
    );
    expect(stored.rows).toEqual([{ value: "5.20" }]);
    await expect(
      inSavepoint(sql`update simulations set state = 'paused' where id = ${row.id}`),
    ).rejects.toThrow(/simulations_state/);
    await expect(
      inSavepoint(
        sql`update simulations set state = 'finished', started_at = now() where id = ${row.id}`,
      ),
    ).rejects.toThrow(/simulations_state/);
    await expect(
      inSavepoint(sql`insert into simulation_test_limits (simulation_id, test_id, kind, yellow_limit, red_limit)
          values (${row.id}, ${testId}, 'ratio', 1, 2)`),
    ).rejects.toThrow(/simulation_test_limits_kind/);
    await expect(
      inSavepoint(sql`delete from catalogue_tests where id = ${testId}`),
    ).rejects.toThrow(/correct_values_test_id_fkey/);
    const down = await migrator.migrateTo("0017_catalogue_follow_ups");
    expect(down.results?.map((r) => [r.migrationName, r.status])).toEqual([
      ["0028_catalogue_unit_ucum", "Success"],
      ["0026_one_active_simulation_per_student", "Success"],
      ["0025_result_ehr_write_lease", "Success"],
      ["0024_result_ehr_writes", "Success"],
      ["0023_measurements_and_release", "Success"],
      ["0022_patient_ehr", "Success"],
      ["0021_lab_tolerances", "Success"],
      ["0020_patients_requests_samples", "Success"],
      ["0019_lab_logos", "Success"],
      ["0018_simulation_state_and_correct_values", "Success"],
    ]);
    await expect(inSavepoint(sql`select id from correct_values`)).rejects.toThrow(
      /relation "correct_values" does not exist/,
    );
    await expect(inSavepoint(sql`select state from simulations`)).rejects.toThrow(
      /column "state" does not exist/,
    );
    expect((await migrator.migrateToLatest()).error).toBeUndefined();
  });

  it("0020_patients_requests_samples checks a lab number by Damm, and reverts (S12, #268)", async () => {
    const database = await createTestDb();
    db = database;
    const migrator = createMigrator(database);
    // The database function and src/lib/lab-number.ts agree, on valid numbers and on each typo.
    const good = ["100000000", "123456789", "908172635"].map(withCheckDigit);
    // Every single-digit typo and every swap of two neighbours of each (review of #351, N1).
    const typos = good.flatMap((number) =>
      [...number].flatMap((char, position) =>
        [..."0123456789"]
          .filter((digit) => digit !== char)
          .map((digit) => `${number.slice(0, position)}${digit}${number.slice(position + 1)}`),
      ),
    );
    const swaps = good.flatMap((number) =>
      [...number.slice(0, -1)].map(
        (char, position) =>
          `${number.slice(0, position)}${number[position + 1]}${char}${number.slice(position + 2)}`,
      ),
    );
    const candidates = [...good, ...typos, ...swaps, "5724", "12345678a0", "12345678901"];
    const checked = await sql<{ ok: boolean }>`
        select lab_number_is_valid(v) as ok
          from unnest(${candidates}::text[]) with ordinality as t(v, n) order by n`.execute(
      database,
    );
    expect(checked.rows.map((row) => row.ok)).toEqual(candidates.map(isLabNumber));
    expect(checked.rows.map((row) => row.ok).slice(0, 3)).toEqual([true, true, true]);
    expect(typos.some(isLabNumber)).toBe(false);
    const down = await migrator.migrateTo("0019_lab_logos");
    expect(down.results?.map((r) => [r.migrationName, r.status])).toEqual([
      ["0028_catalogue_unit_ucum", "Success"],
      ["0026_one_active_simulation_per_student", "Success"],
      ["0025_result_ehr_write_lease", "Success"],
      ["0024_result_ehr_writes", "Success"],
      ["0023_measurements_and_release", "Success"],
      ["0022_patient_ehr", "Success"],
      ["0021_lab_tolerances", "Success"],
      ["0020_patients_requests_samples", "Success"],
    ]);
    const inSavepoint = (query: ReturnType<typeof sql>) =>
      database.transaction().execute((trx) => query.execute(trx));
    await expect(inSavepoint(sql`select id from samples`)).rejects.toThrow(
      /relation "samples" does not exist/,
    );
    await expect(inSavepoint(sql`select lab_number_is_valid('1')`)).rejects.toThrow(
      /function lab_number_is_valid/,
    );
    expect((await migrator.migrateToLatest()).error).toBeUndefined();
  });

  it("0019_lab_logos holds a logo's type, size, dimensions and hash, goes with its lab, and reverts (#292)", async () => {
    const database = await createTestDb();
    db = database;
    const migrator = createMigrator(database);
    const inSavepoint = (query: ReturnType<typeof sql>) =>
      database.transaction().execute((trx) => query.execute(trx));
    const simulation = await sql<{ id: string }>`insert into simulations (name)
        values ('Logo simulation') returning id`.execute(database);
    const simulationId = simulation.rows[0]?.id;
    const lab = await sql<{ id: string }>`insert into labs (simulation_id, name)
        values (${simulationId}, 'Logo lab') returning id`.execute(database);
    const labId = lab.rows[0]?.id;
    const logo = (fields: {
      type?: string;
      content?: ReturnType<typeof sql>;
      size?: number;
      width?: number;
      height?: number;
      sha?: ReturnType<typeof sql>;
    }) => {
      const content = fields.content ?? sql`'\\x0102'::bytea`;
      return inSavepoint(sql`insert into lab_logos (lab_id, content, media_type, byte_size, width, height, sha256)
          values (${labId}, ${content}, ${fields.type ?? "image/png"},
            ${fields.size ?? 2}, ${fields.width ?? 1}, ${fields.height ?? 1},
            ${fields.sha ?? sql`sha256(${content})`})`);
    };
    await expect(logo({ type: "image/svg+xml" })).rejects.toThrow(/lab_logos_media_type/);
    await expect(logo({ size: 3 })).rejects.toThrow(/lab_logos_byte_size/);
    await expect(logo({ content: sql`'\\x'::bytea`, size: 0 })).rejects.toThrow(
      /lab_logos_byte_size/,
    );
    await expect(
      logo({ content: sql`decode(repeat('00', 524289), 'hex')`, size: 524_289 }),
    ).rejects.toThrow(/lab_logos_byte_size/);
    await expect(logo({ width: 1025 })).rejects.toThrow(/lab_logos_dimensions/);
    await expect(logo({ height: 0 })).rejects.toThrow(/lab_logos_dimensions/);
    await expect(logo({ sha: sql`'\\x00'::bytea` })).rejects.toThrow(/lab_logos_sha256/);
    // A hash of 32 bytes that is not the hash of the content (N3, the review of #346).
    await expect(logo({ sha: sql`sha256('\\x0103'::bytea)` })).rejects.toThrow(/lab_logos_sha256/);
    await logo({
      content: sql`decode(repeat('00', 524288), 'hex')`,
      size: 524_288,
      width: 1024,
      height: 1024,
    });
    await expect(logo({})).rejects.toThrow(/lab_logos_pkey/);
    await inSavepoint(sql`delete from labs where id = ${labId}`);
    const left = await sql`select lab_id from lab_logos`.execute(database);
    expect(left.rows).toEqual([]);
    const down = await migrator.migrateTo("0018_simulation_state_and_correct_values");
    expect(down.results?.map((r) => [r.migrationName, r.status])).toEqual([
      ["0028_catalogue_unit_ucum", "Success"],
      ["0026_one_active_simulation_per_student", "Success"],
      ["0025_result_ehr_write_lease", "Success"],
      ["0024_result_ehr_writes", "Success"],
      ["0023_measurements_and_release", "Success"],
      ["0022_patient_ehr", "Success"],
      ["0021_lab_tolerances", "Success"],
      ["0020_patients_requests_samples", "Success"],
      ["0019_lab_logos", "Success"],
    ]);
    await expect(inSavepoint(sql`select lab_id from lab_logos`)).rejects.toThrow(
      /relation "lab_logos" does not exist/,
    );
    expect((await migrator.migrateToLatest()).error).toBeUndefined();
  });

  it("0021_lab_tolerances holds its rules and reverts (#269)", async () => {
    const database = await createTestDb();
    db = database;
    const migrator = createMigrator(database);
    const inSavepoint = (query: ReturnType<typeof sql>) =>
      database.transaction().execute((trx) => query.execute(trx));
    const simulation = await sql<{ id: string }>`
        insert into simulations (name) values ('Migration run') returning id`.execute(database);
    const simulationId = simulation.rows[0]?.id ?? "";
    const lab = await sql<{ id: string }>`insert into labs (simulation_id, name)
        values (${simulationId}, 'Migration lab') returning id`.execute(database);
    const labId = lab.rows[0]?.id ?? "";
    const test = await sql<{
      id: string;
    }>`insert into catalogue_tests (name, unit, material, source)
        values ('Migration test', 'mmol/L', 'plasma', 'manual') returning id`.execute(database);
    const testId = test.rows[0]?.id ?? "";
    const tolerance = (lower: string, upper: string) =>
      inSavepoint(sql`insert into lab_tolerances (simulation_id, lab_id, test_id, lower_limit, upper_limit)
          values (${simulationId}, ${labId}, ${testId}, ${lower}::numeric, ${upper}::numeric)`);
    await tolerance("4.20", "6");
    await tolerance("5", "5");
    await expect(tolerance("6.1", "6")).rejects.toThrow(/lab_tolerances_limits/);
    await expect(tolerance("1.1234567", "2")).rejects.toThrow(/lab_tolerances_limits/);
    await expect(tolerance("1", "1000000000")).rejects.toThrow(/lab_tolerances_limits/);
    const stored = await sql<{ lower: string; set_at: Date | null }>`
        select lower_limit::text as lower, set_at from lab_tolerances order by set_at, id`.execute(
      database,
    );
    expect(stored.rows.map((row) => row.lower)).toEqual(["4.20", "5"]);
    expect(stored.rows.every((row) => row.set_at instanceof Date)).toBe(true);
    await expect(
      inSavepoint(sql`delete from catalogue_tests where id = ${testId}`),
    ).rejects.toThrow(/lab_tolerances_test_id_fkey/);
    await inSavepoint(sql`delete from labs where id = ${labId}`);
    const left = await sql<{ n: string }>`select count(*)::text as n from lab_tolerances`.execute(
      database,
    );
    expect(left.rows).toEqual([{ n: "0" }]);
    const down = await migrator.migrateTo("0020_patients_requests_samples");
    expect(down.results?.map((r) => [r.migrationName, r.status])).toEqual([
      ["0028_catalogue_unit_ucum", "Success"],
      ["0026_one_active_simulation_per_student", "Success"],
      ["0025_result_ehr_write_lease", "Success"],
      ["0024_result_ehr_writes", "Success"],
      ["0023_measurements_and_release", "Success"],
      ["0022_patient_ehr", "Success"],
      ["0021_lab_tolerances", "Success"],
    ]);
    await expect(inSavepoint(sql`select id from lab_tolerances`)).rejects.toThrow(
      /relation "lab_tolerances" does not exist/,
    );
    expect((await migrator.migrateToLatest()).error).toBeUndefined();
  });

  it("0023_measurements_and_release keeps measurements and a release final, and reverts (S14, S15, #270)", async () => {
    const database = await createTestDb();
    db = database;
    const migrator = createMigrator(database);
    const inSavepoint = (query: ReturnType<typeof sql>) =>
      database.transaction().execute((trx) => query.execute(trx));
    const one = async (query: ReturnType<typeof sql<{ id: string }>>) =>
      (await query.execute(database)).rows[0]?.id ?? "";
    const simulationId = await one(sql<{ id: string }>`
        insert into simulations (name) values ('Migration run') returning id`);
    const labId = await one(sql<{ id: string }>`insert into labs (simulation_id, name)
        values (${simulationId}, 'Migration lab') returning id`);
    const otherLabId = await one(sql<{ id: string }>`insert into labs (simulation_id, name)
        values (${simulationId}, 'Other lab') returning id`);
    const testId = await one(sql<{ id: string }>`insert into catalogue_tests
        (name, unit, material, source) values ('Migration test', 'mmol/L', 'plasma', 'manual')
        returning id`);
    const requestId = await one(sql<{ id: string }>`insert into requests
        (simulation_id, lab_id, kind) values (${simulationId}, ${labId}, 'control') returning id`);
    await sql`insert into request_tests (request_id, test_id) values (${requestId}, ${testId})`.execute(
      database,
    );
    const sampleId = await one(sql<{ id: string }>`insert into samples
        (simulation_id, lab_id, request_id, sample_number, material, lab_number)
        values (${simulationId}, ${labId}, ${requestId}, 'QC-1', 'control',
          ${withCheckDigit("123456789")}) returning id`);
    const tolerance = (lab: string) =>
      one(sql<{ id: string }>`insert into lab_tolerances
          (simulation_id, lab_id, test_id, lower_limit, upper_limit)
          values (${simulationId}, ${lab}, ${testId}, 1, 9) returning id`);
    const toleranceId = await tolerance(labId);
    const otherToleranceId = await tolerance(otherLabId);
    const measurement = (value: string, source = "manual") =>
      inSavepoint(sql`insert into measurements
          (simulation_id, lab_id, request_id, test_id, sample_id, value, source)
          values (${simulationId}, ${labId}, ${requestId}, ${testId}, ${sampleId},
            ${value}::numeric, ${source})`);
    await measurement("5.5");
    await measurement("6.25");
    await expect(measurement("1.1234567")).rejects.toThrow(/measurements_value/);
    await expect(measurement("1000000000")).rejects.toThrow(/measurements_value/);
    await expect(measurement("5", "guess")).rejects.toThrow(/measurements_source/);
    // An analyser's measurement has no student (security review of #370, S3).
    const someone = await one(sql<{
      id: string;
    }>`insert into "user" (id, name, email, "emailVerified")
        values ('u-0023', 'Test someone', 'someone-0023@example.test', true) returning id`);
    await expect(
      inSavepoint(sql`insert into measurements
          (simulation_id, lab_id, request_id, test_id, sample_id, value, source, recorded_by)
          values (${simulationId}, ${labId}, ${requestId}, ${testId}, ${sampleId}, 1, 'afinion',
            ${someone})`),
    ).rejects.toThrow(/measurements_recorded_by/);
    // A time the insert carries is replaced by the server's clock (S1).
    await inSavepoint(sql`insert into measurements
        (simulation_id, lab_id, request_id, test_id, sample_id, value, source, recorded_at)
        values (${simulationId}, ${labId}, ${requestId}, ${testId}, ${sampleId}, 7, 'manual',
          '2000-01-01T00:00:00Z')`);
    const smuggled = await sql<{ recorded_at: Date }>`select recorded_at from measurements
        where value = 7`.execute(database);
    expect(smuggled.rows[0]?.recorded_at.getUTCFullYear()).toBeGreaterThan(2000);
    // A measured sample is never deleted on its own (S4).
    await expect(inSavepoint(sql`delete from samples where id = ${sampleId}`)).rejects.toThrow(
      /measurements_sample_fkey|a measurement is never removed/,
    );
    const ids = await sql<{
      id: string;
    }>`select id from measurements where value <> 7 order by recorded_at, id`.execute(database);
    const [first, second] = ids.rows.map((row) => row.id);
    await expect(
      inSavepoint(sql`update measurements set value = 1 where id = ${first}`),
    ).rejects.toThrow(/a measurement never changes/);
    await expect(inSavepoint(sql`delete from measurements where id = ${first}`)).rejects.toThrow(
      /a measurement is never removed/,
    );
    const release = (measurementId: string | undefined, toleranceRow: string) =>
      inSavepoint(sql`update request_tests set released_measurement_id = ${measurementId},
          released_tolerance_id = ${toleranceRow}, released_at = '2000-01-01T00:00:00Z'
          where request_id = ${requestId} and test_id = ${testId}`);
    await expect(release(first, otherToleranceId)).rejects.toThrow(
      /the tolerance of a release belongs to its lab and test/,
    );
    // Who released goes only with a release (N2).
    await expect(
      inSavepoint(sql`update request_tests set released_by = ${someone}
          where request_id = ${requestId} and test_id = ${testId}`),
    ).rejects.toThrow(/request_tests_release/);
    await release(first, toleranceId);
    const stored = await sql<{ released_at: Date }>`select released_at from request_tests
        where request_id = ${requestId}`.execute(database);
    expect(stored.rows[0]?.released_at.getUTCFullYear()).toBeGreaterThan(2000);
    await expect(release(second, toleranceId)).rejects.toThrow(/a released result is final/);
    await expect(
      inSavepoint(
        sql`update request_tests set released_at = clock_timestamp() where request_id = ${requestId}`,
      ),
    ).rejects.toThrow(/a released result is final/);
    await expect(
      inSavepoint(sql`delete from request_tests where request_id = ${requestId}`),
    ).rejects.toThrow(/a released result is final/);
    const otherTestId = await one(sql<{ id: string }>`insert into catalogue_tests
        (name, unit, material, source) values ('Second test', 'mmol/L', 'plasma', 'manual')
        returning id`);
    await expect(
      inSavepoint(sql`insert into request_tests (request_id, test_id, released_at)
          values (${requestId}, ${otherTestId}, now())`),
    ).rejects.toThrow(/request_tests_release_insert|released only by an update/);
    await inSavepoint(sql`delete from labs where id = ${labId}`);
    const left = await sql<{ n: string }>`select count(*)::text as n from measurements`.execute(
      database,
    );
    expect(left.rows).toEqual([{ n: "0" }]);
    const down = await migrator.migrateTo("0022_patient_ehr");
    expect(down.results?.map((r) => [r.migrationName, r.status])).toEqual([
      ["0028_catalogue_unit_ucum", "Success"],
      ["0026_one_active_simulation_per_student", "Success"],
      ["0025_result_ehr_write_lease", "Success"],
      ["0024_result_ehr_writes", "Success"],
      ["0023_measurements_and_release", "Success"],
    ]);
    await expect(inSavepoint(sql`select id from measurements`)).rejects.toThrow(
      /relation "measurements" does not exist/,
    );
    expect((await migrator.migrateToLatest()).error).toBeUndefined();
  });

  it("0026_one_active_simulation_per_student holds one unfinished simulation per student, and reverts (#379)", async () => {
    const database = await createTestDb();
    db = database;
    const migrator = createMigrator(database);
    const inSavepoint = (query: ReturnType<typeof sql>) =>
      database.transaction().execute((trx) => query.execute(trx));
    const one = async (query: ReturnType<typeof sql<{ id: string }>>) =>
      (await query.execute(database)).rows[0]?.id ?? "";
    await sql`insert into "user" (id, name, email, "emailVerified", role)
        values ('u-379', 'Migration student', 'm379@example.test', true, 'student')`.execute(
      database,
    );
    const simulation = (name: string) =>
      one(sql<{ id: string }>`insert into simulations (name) values (${name}) returning id`);
    const lab = (simulationId: string) =>
      one(sql<{ id: string }>`insert into labs (simulation_id, name)
          values (${simulationId}, 'Migration lab') returning id`);
    const join = (simulationId: string, labId: string) =>
      inSavepoint(sql`insert into lab_members (simulation_id, lab_id, user_id, joined_via)
          values (${simulationId}, ${labId}, 'u-379', 'code')`);
    const first = await simulation("First run");
    const second = await simulation("Second run");
    const third = await simulation("Third run");
    const [firstLab, secondLab, thirdLab] = [await lab(first), await lab(second), await lab(third)];
    await join(first, firstLab);
    await expect(join(second, secondLab)).rejects.toThrow(
      /one simulation at a time that is not finished/,
    );
    await sql`update simulations set state = 'finished', started_at = now(), finished_at = now()
        where id = ${first}`.execute(database);
    await join(second, secondLab);
    await expect(join(third, thirdLab)).rejects.toThrow(
      /one simulation at a time that is not finished/,
    );
    const down = await migrator.migrateTo("0025_result_ehr_write_lease");
    expect(down.results?.map((r) => [r.migrationName, r.status])).toEqual([
      ["0028_catalogue_unit_ucum", "Success"],
      ["0026_one_active_simulation_per_student", "Success"],
    ]);
    await join(third, thirdLab);
    // Rows that already break the rule stop the migration (security review of #392, S3).
    const refusedUp = await migrator.migrateToLatest();
    expect(String(refusedUp.error)).toMatch(/more than one simulation that is not finished/);
    await inSavepoint(sql`delete from lab_members where simulation_id = ${third}`);
    expect((await migrator.migrateToLatest()).error).toBeUndefined();
  });
});
