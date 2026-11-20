// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The lease of one attempt at a result write (#382, S15, Q-REL-1). An attempt takes the row with
// a new `lease_id` just before it talks to FerroEHR, and records its outcome only while the row
// still carries that id, so a run whose lease ran out and was taken over changes nothing.
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("result_ehr_writes").addColumn("lease_id", "uuid").execute();
  await sql`alter table result_ehr_writes
    add constraint result_ehr_writes_lease check (state = 'pending' or lease_id is null)`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("result_ehr_writes")
    .dropConstraint("result_ehr_writes_lease")
    .execute();
  await db.schema.alterTable("result_ehr_writes").dropColumn("lease_id").execute();
}
