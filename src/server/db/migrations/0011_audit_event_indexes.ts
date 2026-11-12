// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The indexes of the activity log screen (#36): its order is the event time with the id as
// tie-break, in either direction, so the time index carries the id and a page needs no sort
// step; a target's events come in that order straight from the target index, where a busy user
// otherwise sorted every event about them. A B-tree scans backwards, so one index serves both
// directions. The actor and action indexes of 0005 stay as they are.
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex("audit_event_occurred_at_idx").execute();
  await db.schema
    .createIndex("audit_event_occurred_at_id_idx")
    .on("audit_event")
    .columns(["occurred_at", "id"])
    .execute();
  await db.schema.dropIndex("audit_event_target_idx").execute();
  await db.schema
    .createIndex("audit_event_target_occurred_at_idx")
    .on("audit_event")
    .columns(["target_type", "target_id", "occurred_at", "id"])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex("audit_event_target_occurred_at_idx").execute();
  await db.schema
    .createIndex("audit_event_target_idx")
    .on("audit_event")
    .columns(["target_type", "target_id"])
    .execute();
  await db.schema.dropIndex("audit_event_occurred_at_id_idx").execute();
  await db.schema
    .createIndex("audit_event_occurred_at_idx")
    .on("audit_event")
    .expression(sql`occurred_at desc`)
    .execute();
}
