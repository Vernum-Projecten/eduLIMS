// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Measurements per requested test and the release of one of them as the result (S14, S15,
// #270). A measurement hangs under its requested test and its sample within its lab and is never
// changed or removed. The release lives on the requested test: one row, so at most one released
// measurement, written once with the database clock and the tolerance in force, and final after.
import { type Kysely, sql } from "kysely";

/** The bounds of `src/lib/decimal.ts`, as migrations 0018 and 0021 hold them. */
const INTEGER_BOUND = "1000000000";
const FRACTION_DIGITS = 6;

export async function up(db: Kysely<unknown>): Promise<void> {
  // The target of the measurement's sample key, so a measurement names a sample of its request.
  await sql`alter table samples add constraint samples_id_request_id_key unique (id, request_id)`.execute(
    db,
  );

  await db.schema
    .createTable("measurements")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn("simulation_id", "uuid", (c) => c.notNull())
    .addColumn("lab_id", "uuid", (c) => c.notNull())
    .addColumn("request_id", "uuid", (c) => c.notNull())
    .addColumn("test_id", "uuid", (c) => c.notNull())
    .addColumn("sample_id", "uuid", (c) => c.notNull())
    .addColumn("value", "numeric", (c) => c.notNull())
    .addColumn("source", "text", (c) => c.notNull())
    .addColumn("recorded_by", "text", (c) => c.references("user.id").onDelete("set null"))
    // NOTE: Q-SIM-2; the database clock at the insert, so the measurements of a requested test
    // follow the order in which they arrived.
    .addColumn("recorded_at", "timestamptz", (c) => c.notNull().defaultTo(sql`clock_timestamp()`))
    .addForeignKeyConstraint(
      "measurements_lab_fkey",
      ["lab_id", "simulation_id"],
      "labs",
      ["id", "simulation_id"],
      (c) => c.onDelete("cascade"),
    )
    .addForeignKeyConstraint(
      "measurements_request_fkey",
      ["request_id", "lab_id"],
      "requests",
      ["id", "lab_id"],
      (c) => c.onDelete("cascade"),
    )
    // NOTE: S14; NO ACTION checks at the end of the statement, so a lab's cascade removes both,
    // and a correction cannot drop a requested test that has a measurement.
    .addForeignKeyConstraint(
      "measurements_request_test_fkey",
      ["request_id", "test_id"],
      "request_tests",
      ["request_id", "test_id"],
      (c) => c.onDelete("no action"),
    )
    .addForeignKeyConstraint(
      "measurements_sample_fkey",
      ["sample_id", "request_id"],
      "samples",
      ["id", "request_id"],
      (c) => c.onDelete("cascade"),
    )
    .addUniqueConstraint("measurements_id_request_test_key", ["id", "request_id", "test_id"])
    .addCheckConstraint(
      "measurements_value",
      sql`abs(value) < ${sql.lit(INTEGER_BOUND)}::numeric and scale(value) <= ${sql.lit(FRACTION_DIGITS)}`,
    )
    .addCheckConstraint("measurements_source", sql`source in ('afinion', 'epoch_upload', 'manual')`)
    .execute();
  await db.schema
    .createIndex("measurements_request_test_idx")
    .on("measurements")
    .columns(["request_id", "test_id", "recorded_at", "id"])
    .execute();
  await db.schema
    .createIndex("measurements_sample_id_idx")
    .on("measurements")
    .column("sample_id")
    .execute();
  // NOTE: S14, S15; a measurement is kept as it arrived. Only the user key may go to null, when
  // the account is deleted; a direct delete is refused, a cascade from its lab is not.
  await sql`
    create function measurements_fixed() returns trigger language plpgsql as $$
    begin
      if tg_op = 'DELETE' then
        if pg_trigger_depth() < 2 then
          raise exception 'a measurement is never removed'
            using errcode = 'check_violation', constraint = 'measurements_fixed';
        end if;
        return old;
      end if;
      if (new.id, new.simulation_id, new.lab_id, new.request_id, new.test_id, new.sample_id,
          new.value, new.source, new.recorded_at)
         is distinct from
         (old.id, old.simulation_id, old.lab_id, old.request_id, old.test_id, old.sample_id,
          old.value, old.source, old.recorded_at)
         or (new.recorded_by is distinct from old.recorded_by and new.recorded_by is not null) then
        raise exception 'a measurement never changes'
          using errcode = 'check_violation', constraint = 'measurements_fixed';
      end if;
      return new;
    end $$`.execute(db);
  await sql`
    create trigger measurements_fixed before update or delete on measurements
    for each row execute function measurements_fixed()`.execute(db);

  await db.schema
    .alterTable("request_tests")
    .addColumn("released_measurement_id", "uuid")
    .addColumn("released_tolerance_id", "uuid", (c) =>
      c.references("lab_tolerances.id").onDelete("no action"),
    )
    .addColumn("released_by", "text", (c) => c.references("user.id").onDelete("set null"))
    .execute();
  await sql`alter table request_tests
    add constraint request_tests_released_measurement_fkey
      foreign key (released_measurement_id, request_id, test_id)
      references measurements (id, request_id, test_id) on delete no action,
    add constraint request_tests_release check (
      (released_at is null) = (released_measurement_id is null)
      and (released_at is null) = (released_tolerance_id is null))`.execute(db);
  await db.schema
    .createIndex("request_tests_released_tolerance_idx")
    .on("request_tests")
    .column("released_tolerance_id")
    .execute();
  // NOTE: S15, Q-SIM-2, R-12; the release takes the transaction's clock whatever the update
  // carries, names a tolerance of the request's own lab and test, and is final once written.
  await sql`
    create function request_tests_release() returns trigger language plpgsql as $$
    begin
      if tg_op = 'DELETE' then
        if old.released_at is not null and pg_trigger_depth() < 2 then
          raise exception 'a released result is final'
            using errcode = 'check_violation', constraint = 'request_tests_release_final';
        end if;
        return old;
      end if;
      if tg_op = 'INSERT' then
        if new.released_at is not null or new.released_measurement_id is not null
           or new.released_tolerance_id is not null or new.released_by is not null then
          raise exception 'a requested test is released only by an update'
            using errcode = 'check_violation', constraint = 'request_tests_release_insert';
        end if;
        return new;
      end if;
      if old.released_at is not null then
        if (new.request_id, new.test_id, new.released_at, new.released_measurement_id,
            new.released_tolerance_id)
           is distinct from
           (old.request_id, old.test_id, old.released_at, old.released_measurement_id,
            old.released_tolerance_id)
           or (new.released_by is distinct from old.released_by and new.released_by is not null) then
          raise exception 'a released result is final'
            using errcode = 'check_violation', constraint = 'request_tests_release_final';
        end if;
        return new;
      end if;
      if new.released_measurement_id is not null then
        new.released_at := now();
        if not exists (
          select 1 from lab_tolerances lt join requests r on r.lab_id = lt.lab_id
          where r.id = new.request_id and lt.id = new.released_tolerance_id
            and lt.test_id = new.test_id) then
          raise exception 'the tolerance of a release belongs to its lab and test'
            using errcode = 'check_violation', constraint = 'request_tests_release_tolerance';
        end if;
      end if;
      return new;
    end $$`.execute(db);
  await sql`
    create trigger request_tests_release before insert or update or delete on request_tests
    for each row execute function request_tests_release()`.execute(db);
}

// NOTE: no requirement governs this: our own design. Reverting drops every measurement and
// every release, and the time of release with them.
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop trigger request_tests_release on request_tests`.execute(db);
  await sql`drop function request_tests_release()`.execute(db);
  await sql`alter table request_tests
    drop constraint request_tests_release,
    drop constraint request_tests_released_measurement_fkey,
    drop column released_by,
    drop column released_tolerance_id,
    drop column released_measurement_id`.execute(db);
  await sql`update request_tests set released_at = null`.execute(db);
  await db.schema.dropTable("measurements").execute();
  await sql`drop function measurements_fixed()`.execute(db);
  await sql`alter table samples drop constraint samples_id_request_id_key`.execute(db);
}
