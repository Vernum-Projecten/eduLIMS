// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The steps of the integration check (B3, #227): FerroEHR's reachable, signed-in and
// template-loaded steps with its versions and a refusal's code, and FerroBRIDGE's readiness
// phase and failing indicators. Codes only: never a URL, a secret, a token or a response body.
import { type Kysely, sql } from "kysely";

const STEP_STATE = sql`('passed', 'failed', 'refused', 'missing', 'skipped')`;

export async function up(db: Kysely<unknown>): Promise<void> {
  // NOTE: no requirement governs this: our own design. A row holds only an integration's latest
  // check, written again by the next scheduled check, so the rows from before the steps go.
  await sql`delete from integration_checks`.execute(db);
  await db.schema
    .alterTable("integration_checks")
    .dropConstraint("integration_checks_state")
    .execute();
  await db.schema
    .alterTable("integration_checks")
    .dropConstraint("integration_checks_error_class")
    .execute();
  await db.schema
    .alterTable("integration_checks")
    .addColumn("reachable", "text")
    .addColumn("signed_in", "text")
    .addColumn("template_loaded", "text")
    .addColumn("server_version", "text")
    .addColumn("spec_version", "text")
    .addColumn("sign_in_target", "text")
    .addColumn("auth_reason", "text")
    .addColumn("readiness_phase", "text")
    .addColumn("failing_indicators", sql`text[]`)
    .execute();
  const checks: [string, ReturnType<typeof sql>][] = [
    [
      "integration_checks_state",
      sql`state in ('available', 'unavailable', 'refused', 'not_ready')`,
    ],
    [
      "integration_checks_error_class",
      sql`error_class is null or error_class in ('timeout', 'unreachable', 'auth_refused', 'http_client_error', 'http_server_error', 'unexpected_response', 'template_missing', 'readiness_down')`,
    ],
    [
      "integration_checks_not_ready",
      sql`(state = 'not_ready') = coalesce(error_class in ('template_missing', 'readiness_down'), false)`,
    ],
    [
      "integration_checks_steps",
      sql`(integration = 'ferroehr') = (reachable is not null and signed_in is not null and template_loaded is not null)`,
    ],
    [
      "integration_checks_step_states",
      sql`(reachable is null or reachable in ${STEP_STATE}) and (signed_in is null or signed_in in ${STEP_STATE}) and (template_loaded is null or template_loaded in ${STEP_STATE})`,
    ],
    [
      "integration_checks_versions",
      sql`(server_version is null or server_version ~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$') and (spec_version is null or spec_version ~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$')`,
    ],
    [
      "integration_checks_sign_in_target",
      sql`sign_in_target is null or sign_in_target in ('token_endpoint', 'ferroehr')`,
    ],
    [
      "integration_checks_auth_reason",
      sql`auth_reason is null or (state = 'refused' and auth_reason ~ '^[A-Za-z0-9_.-]{1,64}$')`,
    ],
    [
      "integration_checks_readiness",
      sql`(integration = 'ferrobridge' or (readiness_phase is null and failing_indicators is null)) and (readiness_phase is null or readiness_phase in ('booting', 'serving', 'draining'))`,
    ],
    [
      "integration_checks_failing_indicators",
      sql`failing_indicators is null or cardinality(failing_indicators) = 0 or (cardinality(failing_indicators) <= 16 and array_to_string(failing_indicators, ',') ~ '^[a-z0-9][a-z0-9_-]{0,31}(,[a-z0-9][a-z0-9_-]{0,31})*$')`,
    ],
  ];
  for (const [name, expression] of checks) {
    await db.schema.alterTable("integration_checks").addCheckConstraint(name, expression).execute();
  }
}

// NOTE: no requirement governs this: our own design. Reverting drops the step results; the next
// scheduled check writes the state again.
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`delete from integration_checks`.execute(db);
  for (const name of [
    "integration_checks_state",
    "integration_checks_error_class",
    "integration_checks_not_ready",
    "integration_checks_steps",
    "integration_checks_step_states",
    "integration_checks_versions",
    "integration_checks_sign_in_target",
    "integration_checks_auth_reason",
    "integration_checks_readiness",
    "integration_checks_failing_indicators",
  ]) {
    await db.schema.alterTable("integration_checks").dropConstraint(name).execute();
  }
  await db.schema
    .alterTable("integration_checks")
    .dropColumn("reachable")
    .dropColumn("signed_in")
    .dropColumn("template_loaded")
    .dropColumn("server_version")
    .dropColumn("spec_version")
    .dropColumn("sign_in_target")
    .dropColumn("auth_reason")
    .dropColumn("readiness_phase")
    .dropColumn("failing_indicators")
    .execute();
  await db.schema
    .alterTable("integration_checks")
    .addCheckConstraint(
      "integration_checks_state",
      sql`state in ('available', 'unavailable', 'refused')`,
    )
    .execute();
  await db.schema
    .alterTable("integration_checks")
    .addCheckConstraint(
      "integration_checks_error_class",
      sql`error_class is null or error_class in ('timeout', 'unreachable', 'auth_refused', 'http_client_error', 'http_server_error', 'unexpected_response')`,
    )
    .execute();
}
