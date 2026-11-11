// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { getMigrations } from "better-auth/db/migration";
import type { Kysely } from "kysely";
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
      ["0012_classes", "Success"],
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
      ["0012_classes", "Success"],
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
      ["0012_classes", "Success"],
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
      ["0012_classes", "Success"],
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
      ["0012_classes", "Success"],
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
});
