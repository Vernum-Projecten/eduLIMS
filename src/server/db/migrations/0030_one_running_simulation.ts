// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// One running simulation at a time (D11, D10, owner 2026-11-20 on #386). The start refuses a
// second one with `another_running`; this partial unique index is the last line, so no path and
// no race leaves two simulations running. Prepared and finished simulations are not limited.
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // NOTE: #386; every running row has the same key, so a second one is a unique violation.
  await sql`create unique index simulations_one_running on simulations ((true))
    where state = 'running'`.execute(db);
}

// NOTE: no requirement governs this: our own design. Reverting drops the index only.
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop index simulations_one_running`.execute(db);
}
