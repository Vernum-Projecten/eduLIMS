// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The write of a released result to the patient's record in FerroEHR (S15, #148). The release
// inserts the row as pending in its own transaction, so a release never commits without it; the
// write after the commit, or the retry schedule, marks it written with the version id FerroEHR
// gave. A written row stays written. `contribution_uid` is the idempotency key of the write.
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("result_ehr_writes")
    // NOTE: #148; one write per released measurement, keyed by it, so no second row can exist.
    .addColumn("measurement_id", "uuid", (c) =>
      c.primaryKey().references("measurements.id").onDelete("cascade"),
    )
    .addColumn("contribution_uid", "uuid", (c) => c.notNull().unique())
    .addColumn("state", "text", (c) => c.notNull().defaultTo("pending"))
    .addColumn("version_uid", "text")
    .addColumn("attempts", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("last_error", "text")
    .addColumn("next_attempt_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("written_at", "timestamptz")
    .addCheckConstraint("result_ehr_writes_state", sql`state in ('pending', 'written')`)
    .addCheckConstraint(
      "result_ehr_writes_written",
      sql`(state = 'written') = (version_uid is not null) and (state = 'written') = (written_at is not null)`,
    )
    .addCheckConstraint("result_ehr_writes_attempts", sql`attempts >= 0`)
    .addCheckConstraint(
      "result_ehr_writes_last_error",
      sql`last_error is null or last_error ~ '^[a-z0-9_:.-]{1,64}$'`,
    )
    .execute();
  await sql`create index result_ehr_writes_pending_idx on result_ehr_writes (next_attempt_at, measurement_id)
    where state = 'pending'`.execute(db);
  // NOTE: S15; a released result is final, so its record in FerroEHR is written once and the
  // row that names its version never changes again.
  await sql`
    create function result_ehr_writes_final() returns trigger language plpgsql as $$
    begin
      if old.state = 'written' then
        raise exception 'a written result stays written'
          using errcode = 'check_violation', constraint = 'result_ehr_writes_final';
      end if;
      if new.measurement_id is distinct from old.measurement_id
         or new.contribution_uid is distinct from old.contribution_uid
         or new.created_at is distinct from old.created_at then
        raise exception 'the key of a result write never changes'
          using errcode = 'check_violation', constraint = 'result_ehr_writes_final';
      end if;
      return new;
    end $$`.execute(db);
  await sql`
    create trigger result_ehr_writes_final before update on result_ehr_writes
    for each row execute function result_ehr_writes_final()`.execute(db);
}

// NOTE: #148; reverting forgets which released results reached FerroEHR and their version ids;
// FerroEHR still holds the compositions under their contribution uids.
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("result_ehr_writes").execute();
  await sql`drop function result_ehr_writes_final()`.execute(db);
}
