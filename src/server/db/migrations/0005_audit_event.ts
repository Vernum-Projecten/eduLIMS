// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The activity log (B4): who did what to which object, with which outcome and when. Ids only:
// no name, e-mail, IP address, token, request body or grade. `actor_id` and `target_id` carry no
// foreign key, so a row outlives the user it names (the GDPR erasure path is its own issue).
// The singular table name follows the better-auth tables it sits beside.
// NOTE: ASVS V16.2.5 and the OWASP Logging cheat sheet ("Data to exclude"); no IP is stored, not
// even hashed: no requirement needs one, and the reverse proxy's access log keeps it.
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("audit_event")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn("occurred_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("actor_type", "text", (c) => c.notNull())
    .addColumn("actor_id", "text")
    .addColumn("action", "text", (c) => c.notNull())
    .addColumn("target_type", "text")
    .addColumn("target_id", "text")
    .addColumn("outcome", "text", (c) => c.notNull())
    .addColumn("reason_code", "text")
    .addColumn("provider", "text")
    .addColumn("request_id", "text")
    .addColumn("metadata", "jsonb")
    .addCheckConstraint(
      "audit_event_actor_type",
      sql`actor_type in ('user', 'system', 'anonymous')`,
    )
    .addCheckConstraint("audit_event_actor_id", sql`(actor_type = 'user') = (actor_id is not null)`)
    .addCheckConstraint("audit_event_action", sql`action ~ '^[a-z]+(_[a-z]+)+$'`)
    .addCheckConstraint("audit_event_target", sql`(target_type is null) = (target_id is null)`)
    .addCheckConstraint(
      "audit_event_target_type",
      sql`target_type is null or target_type ~ '^[a-z][a-z_]{0,31}$'`,
    )
    .addCheckConstraint("audit_event_outcome", sql`outcome in ('success', 'failure', 'refused')`)
    .addCheckConstraint(
      "audit_event_reason_code",
      sql`reason_code is null or reason_code ~ '^[a-z0-9_]{1,64}$'`,
    )
    .addCheckConstraint(
      "audit_event_provider",
      sql`provider is null or provider in ('microsoft', 'keycloak', 'credential')`,
    )
    .addCheckConstraint(
      "audit_event_metadata",
      sql`metadata is null or jsonb_typeof(metadata) = 'object'`,
    )
    .execute();

  await db.schema
    .createIndex("audit_event_occurred_at_idx")
    .on("audit_event")
    .expression(sql`occurred_at desc`)
    .execute();
  await db.schema
    .createIndex("audit_event_actor_id_occurred_at_idx")
    .on("audit_event")
    .columns(["actor_id", "occurred_at"])
    .execute();
  await db.schema
    .createIndex("audit_event_action_occurred_at_idx")
    .on("audit_event")
    .columns(["action", "occurred_at"])
    .execute();
  await db.schema
    .createIndex("audit_event_target_idx")
    .on("audit_event")
    .columns(["target_type", "target_id"])
    .execute();
}

// NOTE: no requirement governs this: our own design. Reverting drops the activity log with
// every event in it.
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("audit_event").execute();
}
