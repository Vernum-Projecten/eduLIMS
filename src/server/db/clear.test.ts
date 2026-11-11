// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { type Kysely, sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { assertResettable, assertTestDatabase, clearDatabase, describeDatabase } from "./clear.ts";
import type { DB } from "./schema.gen.ts";
import { createTestDb } from "./test-db.ts";

const LOCAL = "postgres://edulims:edulims@127.0.0.1:5432/edulims";

describe("assertResettable", () => {
  it("allows a localhost database in development", () => {
    expect(assertResettable({ NODE_ENV: "development", DATABASE_URL: LOCAL })).toEqual({
      host: "127.0.0.1",
      port: "5432",
      database: "edulims",
    });
  });

  it.each(["postgres://u:p@localhost/edulims", "postgres://u:p@[::1]:5433/edulims"])(
    "allows the loopback address %s in test",
    (url) => {
      expect(assertResettable({ NODE_ENV: "test", DATABASE_URL: url }).database).toBe("edulims");
    },
  );

  it.each(["production", undefined, "staging"])("refuses NODE_ENV=%s", (nodeEnv) => {
    expect(() => assertResettable({ NODE_ENV: nodeEnv, DATABASE_URL: LOCAL })).toThrow(
      /Refusing to reset: NODE_ENV/,
    );
  });

  it.each([
    "postgres://u:p@db.example.test:5432/edulims",
    "postgres://u:p@10.0.0.5/edulims",
    "postgres://u:p@postgres:5432/edulims",
  ])("refuses the non-local host in %s", (url) => {
    expect(() => assertResettable({ NODE_ENV: "development", DATABASE_URL: url })).toThrow(
      /is not localhost/,
    );
  });

  it("refuses a URL without a database name", () => {
    expect(() =>
      assertResettable({ NODE_ENV: "development", DATABASE_URL: "postgres://u:p@localhost" }),
    ).toThrow(/names no database/);
  });
});

describe("assertTestDatabase", () => {
  it("allows a local database whose name ends in _test", () => {
    expect(assertTestDatabase("postgres://u:p@127.0.0.1/edulims_test").database).toBe(
      "edulims_test",
    );
  });

  it("allows the run database of a _test database (#69)", () => {
    expect(
      assertTestDatabase("postgres://u:p@127.0.0.1/edulims_test_mhv1abc_0a1b2c").database,
    ).toBe("edulims_test_mhv1abc_0a1b2c");
  });

  it.each(["edulims_test_feature", "edulims_mhv1abc_0a1b2c", "edulims_e2e_mhv1abc_0a1b2c"])(
    "refuses %s, which is no test or test run database",
    (name) => {
      expect(() => assertTestDatabase(`postgres://u:p@127.0.0.1/${name}`)).toThrow(
        /must end in _test/,
      );
    },
  );

  it("refuses the development database", () => {
    expect(() => assertTestDatabase(LOCAL)).toThrow(/must end in _test/);
  });

  it("refuses a remote test database", () => {
    expect(() => assertTestDatabase("postgres://u:p@ci.example.test/edulims_test")).toThrow(
      /is not localhost/,
    );
  });
});

describe("describeDatabase", () => {
  it("defaults the port and decodes the name", () => {
    expect(describeDatabase("postgres://u:p@localhost/my%20db")).toEqual({
      host: "localhost",
      port: "5432",
      database: "my db",
    });
  });
});

describe("clearDatabase", () => {
  let db: Kysely<DB> | undefined;

  afterEach(async () => {
    await db?.destroy();
    db = undefined;
  });

  it("drops every table, view, sequence, function and type, and keeps the schema", async () => {
    db = await createTestDb();
    await sql`create type mood as enum ('ok')`.execute(db);
    await sql`create domain positive as integer check (value > 0)`.execute(db);
    await sql`create sequence counter`.execute(db);
    await sql`create view user_names as select name from "user"`.execute(db);
    await sql`create materialized view user_count as select count(*) from "user"`.execute(db);
    await sql`create function answer() returns integer language sql as 'select 42'`.execute(db);

    await clearDatabase(db);

    const { rows } = await sql<{ kind: string; count: number }>`
      select 'relation' as kind, count(*)::int as count from pg_class
        where relnamespace = current_schema()::regnamespace
      union all
      select 'function', count(*)::int from pg_proc
        where pronamespace = current_schema()::regnamespace
      union all
      select 'type', count(*)::int from pg_type
        where typnamespace = current_schema()::regnamespace
      union all
      select 'schema', count(*)::int from pg_namespace where nspname = current_schema()
    `.execute(db);
    expect(rows).toEqual([
      { kind: "relation", count: 0 },
      { kind: "function", count: 0 },
      { kind: "type", count: 0 },
      { kind: "schema", count: 1 },
    ]);
  });
});
