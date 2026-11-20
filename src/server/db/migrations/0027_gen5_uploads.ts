// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The Gen5 uploads of a lab (S4, S10, S14, #156). An upload keeps the 96 values of the plate and
// the reader's serial number, and each well's link to a sample of the same lab, set once. A
// measurement from an upload names it, so its wells and its device stay beside it (#148).
import { type Kysely, sql } from "kysely";

/** The bounds of `src/lib/decimal.ts`, as migrations 0018, 0021 and 0023 hold them. */
const INTEGER_BOUND = "1000000000";
const FRACTION_DIGITS = 6;

export async function up(db: Kysely<unknown>): Promise<void> {
  // The target of a well's sample key, so a well links only a sample of its own lab (S10).
  await sql`alter table samples add constraint samples_id_lab_id_key unique (id, lab_id)`.execute(
    db,
  );

  await db.schema
    .createTable("uploads")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn("simulation_id", "uuid", (c) => c.notNull())
    .addColumn("lab_id", "uuid", (c) => c.notNull())
    .addColumn("uploaded_by", "text", (c) => c.references("user.id").onDelete("set null"))
    // NOTE: Q-SIM-2; the database clock, whatever the insert carries (the trigger below).
    .addColumn("uploaded_at", "timestamptz", (c) => c.notNull().defaultTo(sql`clock_timestamp()`))
    .addColumn("reader_serial_number", "text", (c) => c.notNull())
    .addColumn("wavelength_nm", "integer", (c) => c.notNull())
    .addColumn("linked_by", "text", (c) => c.references("user.id").onDelete("set null"))
    .addColumn("linked_at", "timestamptz")
    .addForeignKeyConstraint(
      "uploads_lab_fkey",
      ["lab_id", "simulation_id"],
      "labs",
      ["id", "simulation_id"],
      (c) => c.onDelete("cascade"),
    )
    .addUniqueConstraint("uploads_id_lab_id_key", ["id", "lab_id"])
    .addCheckConstraint(
      "uploads_reader_serial_number",
      sql`reader_serial_number ~ '^[A-Za-z0-9]{1,32}$'`,
    )
    .addCheckConstraint("uploads_wavelength_nm", sql`wavelength_nm between 1 and 9999`)
    .addCheckConstraint("uploads_linked", sql`linked_at is not null or linked_by is null`)
    .execute();
  await db.schema
    .createIndex("uploads_lab_id_idx")
    .on("uploads")
    .columns(["lab_id", "uploaded_at", "id"])
    .execute();

  await db.schema
    .createTable("upload_wells")
    .addColumn("upload_id", "uuid", (c) => c.notNull())
    .addColumn("lab_id", "uuid", (c) => c.notNull())
    .addColumn("well", "text", (c) => c.notNull())
    .addColumn("absorbance", "numeric", (c) => c.notNull())
    .addColumn("sample_id", "uuid")
    .addPrimaryKeyConstraint("upload_wells_pk", ["upload_id", "well"])
    .addForeignKeyConstraint(
      "upload_wells_upload_fkey",
      ["upload_id", "lab_id"],
      "uploads",
      ["id", "lab_id"],
      (c) => c.onDelete("cascade"),
    )
    // NOTE: the lab's own cascade, so a lab's removal deletes its wells before the check of
    // the sample key below runs, as it does for its measurements (0023).
    .addForeignKeyConstraint("upload_wells_lab_fkey", ["lab_id"], "labs", ["id"], (c) =>
      c.onDelete("cascade"),
    )
    // NOTE: S10, R-06; the sample is one of the well's own lab, held by the database too.
    .addForeignKeyConstraint(
      "upload_wells_sample_fkey",
      ["sample_id", "lab_id"],
      "samples",
      ["id", "lab_id"],
      (c) => c.onDelete("no action"),
    )
    .addCheckConstraint("upload_wells_well", sql`well ~ '^[A-H]([1-9]|1[0-2])$'`)
    .addCheckConstraint(
      "upload_wells_absorbance",
      sql`abs(absorbance) < ${sql.lit(INTEGER_BOUND)}::numeric and scale(absorbance) <= ${sql.lit(FRACTION_DIGITS)}`,
    )
    .execute();
  await db.schema
    .createIndex("upload_wells_sample_id_idx")
    .on("upload_wells")
    .column("sample_id")
    .execute();

  await db.schema.alterTable("measurements").addColumn("upload_id", "uuid").execute();
  await sql`alter table measurements
    add constraint measurements_upload_fkey foreign key (upload_id, lab_id)
      references uploads (id, lab_id) on delete no action,
    add constraint measurements_upload check ((source = 'epoch_upload') = (upload_id is not null))`.execute(
    db,
  );
  await db.schema
    .createIndex("measurements_upload_id_idx")
    .on("measurements")
    .column("upload_id")
    .execute();
  await replaceMeasurementsFixed(db, true);

  // NOTE: S4, S14; an upload is kept as it arrived: its clock is the server's, its links are
  // set once, and only a user key may go to null when the account is deleted.
  await sql`
    create function uploads_fixed() returns trigger language plpgsql as $$
    begin
      if tg_op = 'INSERT' then
        new.uploaded_at := clock_timestamp();
        new.linked_at := null;
        new.linked_by := null;
        return new;
      end if;
      if tg_op = 'DELETE' then
        if pg_trigger_depth() < 2 then
          raise exception 'an upload is never removed'
            using errcode = 'check_violation', constraint = 'uploads_fixed';
        end if;
        return old;
      end if;
      if (new.id, new.simulation_id, new.lab_id, new.uploaded_at, new.reader_serial_number,
          new.wavelength_nm) is distinct from
         (old.id, old.simulation_id, old.lab_id, old.uploaded_at, old.reader_serial_number,
          old.wavelength_nm)
         or (new.uploaded_by is distinct from old.uploaded_by and new.uploaded_by is not null) then
        raise exception 'an upload never changes'
          using errcode = 'check_violation', constraint = 'uploads_fixed';
      end if;
      if old.linked_at is null and new.linked_at is not null then
        new.linked_at := clock_timestamp();
      elsif new.linked_at is distinct from old.linked_at
         or (new.linked_by is distinct from old.linked_by and new.linked_by is not null) then
        raise exception 'the links of an upload are set once'
          using errcode = 'check_violation', constraint = 'uploads_fixed';
      end if;
      return new;
    end $$`.execute(db);
  await sql`
    create trigger uploads_fixed before insert or update or delete on uploads
    for each row execute function uploads_fixed()`.execute(db);

  // NOTE: S4, S10; a well keeps its value, and its sample is set once, while its upload is not
  // yet linked; a well is removed only with its lab.
  await sql`
    create function upload_wells_fixed() returns trigger language plpgsql as $$
    begin
      if tg_op = 'DELETE' then
        if pg_trigger_depth() < 2 then
          raise exception 'a well of an upload is never removed'
            using errcode = 'check_violation', constraint = 'upload_wells_fixed';
        end if;
        return old;
      end if;
      if (new.upload_id, new.lab_id, new.well, new.absorbance)
         is distinct from (old.upload_id, old.lab_id, old.well, old.absorbance)
         or old.sample_id is not null
         or exists (select 1 from uploads u where u.id = old.upload_id and u.linked_at is not null)
      then
        raise exception 'a well of an upload never changes once linked'
          using errcode = 'check_violation', constraint = 'upload_wells_fixed';
      end if;
      return new;
    end $$`.execute(db);
  await sql`
    create trigger upload_wells_fixed before update or delete on upload_wells
    for each row execute function upload_wells_fixed()`.execute(db);
}

/** Recreates `measurements_fixed` of migration 0023, with or without `upload_id` in the row. */
async function replaceMeasurementsFixed(db: Kysely<unknown>, withUpload: boolean): Promise<void> {
  const columns = withUpload ? sql`, new.upload_id` : sql``;
  const old = withUpload ? sql`, old.upload_id` : sql``;
  await sql`
    create or replace function measurements_fixed() returns trigger language plpgsql as $$
    begin
      if tg_op = 'DELETE' then
        if pg_trigger_depth() < 2 then
          raise exception 'a measurement is never removed'
            using errcode = 'check_violation', constraint = 'measurements_fixed';
        end if;
        return old;
      end if;
      if (new.id, new.simulation_id, new.lab_id, new.request_id, new.test_id, new.sample_id,
          new.value, new.source, new.recorded_at${columns})
         is distinct from
         (old.id, old.simulation_id, old.lab_id, old.request_id, old.test_id, old.sample_id,
          old.value, old.source, old.recorded_at${old})
         or (new.recorded_by is distinct from old.recorded_by and new.recorded_by is not null) then
        raise exception 'a measurement never changes'
          using errcode = 'check_violation', constraint = 'measurements_fixed';
      end if;
      return new;
    end $$`.execute(db);
}

// NOTE: no requirement governs this: our own design. Reverting drops every upload, its wells
// and links, and the upload of every measurement that came from one.
export async function down(db: Kysely<unknown>): Promise<void> {
  await replaceMeasurementsFixed(db, false);
  await sql`alter table measurements
    drop constraint measurements_upload,
    drop constraint measurements_upload_fkey`.execute(db);
  await db.schema.dropIndex("measurements_upload_id_idx").execute();
  await db.schema.alterTable("measurements").dropColumn("upload_id").execute();
  await db.schema.dropTable("upload_wells").execute();
  await sql`drop function upload_wells_fixed()`.execute(db);
  await db.schema.dropTable("uploads").execute();
  await sql`drop function uploads_fixed()`.execute(db);
  await sql`alter table samples drop constraint samples_id_lab_id_key`.execute(db);
}
