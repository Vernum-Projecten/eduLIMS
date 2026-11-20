// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The EHR of a registered patient in FerroEHR (S11, Q-TRACE-1, #147). `ehr_id` is the id FerroEHR
// gave the EHR whose subject is the patient's id; null means the EHR is pending, because FerroEHR
// did not answer when the patient was registered. No two patients share an EHR.
import type { Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("patients")
    .addColumn("ehr_id", "uuid", (c) => c.unique())
    .execute();
}

// NOTE: #147; dropping the column forgets each patient's EHR id, which a retry finds again by
// its subject in FerroEHR.
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("patients").dropColumn("ehr_id").execute();
}
