// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { getMigrations } from "better-auth/db/migration";
import { type Kysely, sql } from "kysely";
import { NO_MIGRATIONS } from "kysely/migration";
import { afterEach, describe, expect, it } from "vitest";
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
      ["0015_integration_check_steps", "Success"],
      ["0014_class_join_code", "Success"],
      ["0013_scim", "Success"],
      ["0012_classes", "Success"],
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
      ["0015_integration_check_steps", "Success"],
      ["0014_class_join_code", "Success"],
      ["0013_scim", "Success"],
      ["0012_classes", "Success"],
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
      ["0015_integration_check_steps", "Success"],
      ["0014_class_join_code", "Success"],
      ["0013_scim", "Success"],
      ["0012_classes", "Success"],
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
      ["0015_integration_check_steps", "Success"],
      ["0014_class_join_code", "Success"],
      ["0013_scim", "Success"],
      ["0012_classes", "Success"],
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
      ["0015_integration_check_steps", "Success"],
      ["0014_class_join_code", "Success"],
      ["0013_scim", "Success"],
      ["0012_classes", "Success"],
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
      ["0015_integration_check_steps", "Success"],
      ["0014_class_join_code", "Success"],
      ["0013_scim", "Success"],
      ["0012_classes", "Success"],
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
    // The migration below 0013 is 0012_classes; 0015, 0014 and then 0013 revert.
    const down = await migrator.migrateTo("0012_classes");
    expect(down.results?.map((r) => [r.migrationName, r.status])).toEqual([
      ["0015_integration_check_steps", "Success"],
      ["0014_class_join_code", "Success"],
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
    const down = await migrator.migrateTo("0014_class_join_code");
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
    const down = await migrator.migrateTo("0014_class_join_code");
    expect(down.results?.map((r) => [r.migrationName, r.status])).toEqual([
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
});
