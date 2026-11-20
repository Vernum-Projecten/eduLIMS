// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Patients, requests and samples from the paper request form (S11, S12, S16, #268). Every row
// hangs under a lab within its simulation through a composite foreign key, so a row of one lab
// can never name another lab's patient or request. The time of entry is the database clock of the
// storing transaction and never changes; the lab number is ten digits with a Damm check digit,
// unique across every simulation.
import { type Kysely, sql } from "kysely";

/** The bounds of `src/lib/lab-records.ts` (our own design, #268). */
const NAME_MAX = 100;
const IDENTIFIER_MAX = 40;
const REQUESTER_MAX = 100;
const REMARKS_MAX = 1000;
const SAMPLE_NUMBER_MAX = 40;
const MATERIAL_MAX = 40;

/** A trimmed, non-empty text of at most `max` characters without control characters. */
function formText(column: string, max: number) {
  return sql`${sql.ref(column)} = btrim(${sql.ref(column)}) and char_length(${sql.ref(column)}) between 1 and ${sql.lit(max)} and ${sql.ref(column)} !~ '[[:cntrl:]]'`;
}

/** The composite foreign key of a row to its lab within its simulation. */
const LAB_KEY = ["lab_id", "simulation_id"] as const;

export async function up(db: Kysely<unknown>): Promise<void> {
  // NOTE: #268 (maintainer, 2026-11-19); the Damm quasigroup of order 10 catches every single
  // wrong digit and every swap of two neighbours, the same table as `src/lib/lab-number.ts`.
  await sql`
    create function lab_number_is_valid(value text) returns boolean
    language plpgsql immutable strict parallel safe as $$
    declare
      t constant smallint[] := array[
        [0,3,1,7,5,9,8,6,4,2], [7,0,9,2,1,5,4,8,6,3], [4,2,0,6,8,7,1,3,5,9],
        [1,7,5,0,9,8,3,4,2,6], [6,1,2,3,0,4,5,9,7,8], [3,6,7,4,2,0,9,5,8,1],
        [5,8,6,9,7,2,0,1,3,4], [8,9,4,5,3,6,2,0,1,7], [9,4,3,8,6,1,7,2,0,5],
        [2,5,8,1,4,3,6,7,9,0]];
      interim smallint := 0;
    begin
      if value !~ '^[0-9]{10}$' then return false; end if;
      for i in 1..10 loop
        interim := t[interim + 1][substr(value, i, 1)::int + 1];
      end loop;
      return interim = 0;
    end $$`.execute(db);

  await db.schema
    .createTable("patients")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn("simulation_id", "uuid", (c) => c.notNull())
    .addColumn("lab_id", "uuid", (c) => c.notNull())
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("date_of_birth", "date", (c) => c.notNull())
    .addColumn("sex", "text", (c) => c.notNull())
    .addColumn("identifier", "text", (c) => c.notNull())
    .addColumn("created_by", "text", (c) => c.references("user.id").onDelete("set null"))
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("updated_by", "text", (c) => c.references("user.id").onDelete("set null"))
    .addColumn("updated_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addForeignKeyConstraint(
      "patients_lab_fkey",
      [...LAB_KEY],
      "labs",
      ["id", "simulation_id"],
      (c) => c.onDelete("cascade"),
    )
    .addUniqueConstraint("patients_id_lab_id_key", ["id", "lab_id"])
    .addCheckConstraint("patients_name", formText("name", NAME_MAX))
    .addCheckConstraint("patients_identifier", formText("identifier", IDENTIFIER_MAX))
    .addCheckConstraint("patients_sex", sql`sex in ('female', 'male', 'other', 'unknown')`)
    .execute();
  await db.schema
    .createIndex("patients_lab_id_idx")
    .on("patients")
    .columns(["lab_id", "created_at"])
    .execute();

  await db.schema
    .createTable("requests")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn("simulation_id", "uuid", (c) => c.notNull())
    .addColumn("lab_id", "uuid", (c) => c.notNull())
    .addColumn("kind", "text", (c) => c.notNull())
    .addColumn("patient_id", "uuid")
    .addColumn("requester", "text")
    .addColumn("phone_through", "boolean", (c) => c.notNull().defaultTo(false))
    .addColumn("remarks", "text")
    // NOTE: G-01, Q-SIM-2; the trigger below sets it from the storing transaction's clock.
    .addColumn("entered_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("created_by", "text", (c) => c.references("user.id").onDelete("set null"))
    .addColumn("updated_by", "text", (c) => c.references("user.id").onDelete("set null"))
    .addColumn("updated_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addForeignKeyConstraint(
      "requests_lab_fkey",
      [...LAB_KEY],
      "labs",
      ["id", "simulation_id"],
      (c) => c.onDelete("cascade"),
    )
    // NOTE: no requirement governs this: our own design; NO ACTION checks at the end of the
    // statement, so deleting a lab removes its requests and patients together.
    .addForeignKeyConstraint(
      "requests_patient_fkey",
      ["patient_id", "lab_id"],
      "patients",
      ["id", "lab_id"],
      (c) => c.onDelete("no action"),
    )
    .addUniqueConstraint("requests_id_lab_id_key", ["id", "lab_id"])
    .addCheckConstraint("requests_kind", sql`kind in ('patient', 'control')`)
    // NOTE: S16; a control request has no patient, a patient request has one and its requester.
    .addCheckConstraint(
      "requests_patient",
      sql`(kind = 'patient') = (patient_id is not null) and (kind = 'control' or requester is not null)`,
    )
    .addCheckConstraint(
      "requests_requester",
      sql`requester is null or (${formText("requester", REQUESTER_MAX)})`,
    )
    .addCheckConstraint(
      "requests_remarks",
      sql`remarks is null or (remarks = btrim(remarks) and char_length(remarks) between 1 and ${sql.lit(REMARKS_MAX)} and remarks !~ '[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]')`,
    )
    .execute();
  await db.schema
    .createIndex("requests_lab_id_idx")
    .on("requests")
    .columns(["lab_id", "entered_at"])
    .execute();
  await db.schema
    .createIndex("requests_patient_id_idx")
    .on("requests")
    .column("patient_id")
    .execute();
  await sql`
    create function requests_entered_at() returns trigger language plpgsql as $$
    begin
      if tg_op = 'INSERT' then
        new.entered_at := now();
      elsif new.entered_at is distinct from old.entered_at then
        raise exception 'the time of entry of a request never changes'
          using errcode = 'check_violation', constraint = 'requests_entered_at';
      end if;
      return new;
    end $$`.execute(db);
  await sql`
    create trigger requests_entered_at before insert or update on requests
    for each row execute function requests_entered_at()`.execute(db);

  await db.schema
    .createTable("request_tests")
    .addColumn("request_id", "uuid", (c) =>
      c.notNull().references("requests.id").onDelete("cascade"),
    )
    // NOTE: #268 security note from #319; the foreign key serialises a request against a
    // concurrent catalogue edit, and a test a request names is never deleted (D9).
    .addColumn("test_id", "uuid", (c) =>
      c.notNull().references("catalogue_tests.id").onDelete("restrict"),
    )
    // TODO(#270): the release writes this; until then nothing sets it, and corrections read it.
    .addColumn("released_at", "timestamptz")
    .addPrimaryKeyConstraint("request_tests_pk", ["request_id", "test_id"])
    .execute();
  await db.schema
    .createIndex("request_tests_test_id_idx")
    .on("request_tests")
    .column("test_id")
    .execute();

  await db.schema
    .createTable("samples")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn("simulation_id", "uuid", (c) => c.notNull())
    .addColumn("lab_id", "uuid", (c) => c.notNull())
    .addColumn("request_id", "uuid", (c) => c.notNull())
    .addColumn("sample_number", "text", (c) => c.notNull())
    .addColumn("material", "text", (c) => c.notNull())
    .addColumn("lab_number", "text", (c) => c.notNull())
    .addColumn("created_by", "text", (c) => c.references("user.id").onDelete("set null"))
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("updated_by", "text", (c) => c.references("user.id").onDelete("set null"))
    .addColumn("updated_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addForeignKeyConstraint(
      "samples_lab_fkey",
      [...LAB_KEY],
      "labs",
      ["id", "simulation_id"],
      (c) => c.onDelete("cascade"),
    )
    .addForeignKeyConstraint(
      "samples_request_fkey",
      ["request_id", "lab_id"],
      "requests",
      ["id", "lab_id"],
      (c) => c.onDelete("cascade"),
    )
    // NOTE: S12, R-11; unique across every simulation, so an analyser result finds one sample.
    .addUniqueConstraint("samples_lab_number_key", ["lab_number"])
    .addCheckConstraint("samples_lab_number", sql`lab_number_is_valid(lab_number)`)
    .addCheckConstraint("samples_sample_number", formText("sample_number", SAMPLE_NUMBER_MAX))
    .addCheckConstraint("samples_material", formText("material", MATERIAL_MAX))
    .execute();
  // NOTE: S12; no unique key on the sample number within a lab: a second tube is allowed.
  await db.schema
    .createIndex("samples_request_id_idx")
    .on("samples")
    .columns(["request_id", "created_at"])
    .execute();
  // NOTE: S12, R-11 (security review of #351, N2); the team typed the lab number on the
  // analyser, so changing it would send a result to another sample.
  await sql`
    create function samples_lab_number_fixed() returns trigger language plpgsql as $$
    begin
      if new.lab_number is distinct from old.lab_number then
        raise exception 'the lab number of a sample never changes'
          using errcode = 'check_violation', constraint = 'samples_lab_number_fixed';
      end if;
      return new;
    end $$`.execute(db);
  await sql`
    create trigger samples_lab_number_fixed before update on samples
    for each row execute function samples_lab_number_fixed()`.execute(db);

  await db.schema
    .createTable("record_corrections")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn("simulation_id", "uuid", (c) => c.notNull())
    .addColumn("lab_id", "uuid", (c) => c.notNull())
    .addColumn("patient_id", "uuid")
    .addColumn("request_id", "uuid")
    .addColumn("corrected_by", "text", (c) => c.references("user.id").onDelete("set null"))
    .addColumn("corrected_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("changes", "jsonb", (c) => c.notNull())
    .addForeignKeyConstraint(
      "record_corrections_lab_fkey",
      [...LAB_KEY],
      "labs",
      ["id", "simulation_id"],
      (c) => c.onDelete("cascade"),
    )
    .addForeignKeyConstraint(
      "record_corrections_patient_fkey",
      ["patient_id", "lab_id"],
      "patients",
      ["id", "lab_id"],
      (c) => c.onDelete("cascade"),
    )
    .addForeignKeyConstraint(
      "record_corrections_request_fkey",
      ["request_id", "lab_id"],
      "requests",
      ["id", "lab_id"],
      (c) => c.onDelete("cascade"),
    )
    .addCheckConstraint("record_corrections_target", sql`num_nonnulls(patient_id, request_id) = 1`)
    .addCheckConstraint(
      "record_corrections_changes",
      sql`jsonb_typeof(changes) = 'array' and jsonb_array_length(changes) > 0`,
    )
    .execute();
  await db.schema
    .createIndex("record_corrections_simulation_idx")
    .on("record_corrections")
    .columns(["simulation_id", "corrected_at", "id"])
    .execute();
}

// NOTE: no requirement governs this: our own design. Reverting drops every patient, request,
// sample and correction.
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("record_corrections").execute();
  await db.schema.dropTable("samples").execute();
  await sql`drop function samples_lab_number_fixed()`.execute(db);
  await db.schema.dropTable("request_tests").execute();
  await db.schema.dropTable("requests").execute();
  await sql`drop function requests_entered_at()`.execute(db);
  await db.schema.dropTable("patients").execute();
  await sql`drop function lab_number_is_valid(text)`.execute(db);
}
