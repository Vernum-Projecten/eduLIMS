// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The latest health check of each integration (B3, #35): one row per integration, replaced by
// every check. It holds the state, the time of the check and of the last success, the response
// time and an error class from a fixed list: never a URL, a secret or a response body.
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("integration_checks")
    .addColumn("integration", "text", (c) => c.primaryKey())
    .addColumn("state", "text", (c) => c.notNull())
    .addColumn("checked_at", "timestamptz", (c) => c.notNull())
    .addColumn("last_success_at", "timestamptz")
    .addColumn("response_time_ms", "integer")
    .addColumn("error_class", "text")
    .addCheckConstraint(
      "integration_checks_integration",
      sql`integration in ('ferroehr', 'ferrobridge')`,
    )
    .addCheckConstraint(
      "integration_checks_state",
      sql`state in ('available', 'unavailable', 'refused')`,
    )
    .addCheckConstraint(
      "integration_checks_error_class",
      sql`error_class is null or error_class in ('timeout', 'unreachable', 'auth_refused', 'http_client_error', 'http_server_error', 'unexpected_response')`,
    )
    .addCheckConstraint(
      "integration_checks_error_state",
      sql`(state = 'available') = (error_class is null)`,
    )
    .addCheckConstraint(
      "integration_checks_refused",
      sql`(state = 'refused') = (error_class is not distinct from 'auth_refused')`,
    )
    .addCheckConstraint(
      "integration_checks_response_time",
      sql`response_time_ms is null or response_time_ms >= 0`,
    )
    .execute();
}

// NOTE: no requirement governs this: our own design. Reverting drops the latest check results;
// the next scheduled check writes them again.
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("integration_checks").execute();
}
