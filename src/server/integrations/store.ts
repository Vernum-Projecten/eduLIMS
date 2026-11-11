// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The latest check result per integration (B3, #35), in `integration_checks`: written by every
// check, read by the Admin portal's status screen.
import "@tanstack/react-start/server-only";
import { type Kysely, sql } from "kysely";
import {
  type CheckErrorClass,
  type CheckState,
  INTEGRATIONS,
  type Integration,
  type IntegrationDisplayState,
  parseCheckErrorClass,
  parseCheckState,
  parseIntegration,
  STALE_CHECK_MS,
} from "../../lib/integrations.ts";
import type { DB } from "../db/schema.gen.ts";
import type { CheckResult } from "./probe.ts";

/** One integration as the status screen shows it. */
export interface IntegrationStatus {
  integration: Integration;
  state: IntegrationDisplayState;
  /** ISO instants; `null` before the first check or the first success. */
  checkedAt: string | null;
  lastSuccessAt: string | null;
  responseTimeMs: number | null;
  errorClass: CheckErrorClass | null;
}

/** The status screen's data: every integration, and when it was read. */
export interface IntegrationStatusPage {
  integrations: IntegrationStatus[];
  /** The instant of the read; ages count from it, so SSR and the client agree. */
  readAt: string;
}

/** Thrown when a stored row holds a value outside the vocabulary the CHECKs allow. */
export class IntegrationCheckInvalidError extends Error {
  override readonly name = "IntegrationCheckInvalidError";
  readonly kind = "integration_check_invalid";
}

/**
 * Stores one check result as the integration's latest. A success also becomes its last success;
 * a failure keeps the last success it had. An older result never replaces a newer one, so two
 * checks that finish out of order leave the later one.
 */
export async function saveCheck(db: Kysely<DB>, result: CheckResult): Promise<void> {
  const available = result.state === "available";
  await db
    .insertInto("integration_checks")
    .values({
      integration: result.integration,
      state: result.state,
      checked_at: result.checkedAt,
      last_success_at: available ? result.checkedAt : null,
      response_time_ms: result.responseTimeMs,
      error_class: result.errorClass,
    })
    .onConflict((oc) =>
      oc
        .column("integration")
        .doUpdateSet((eb) => ({
          state: eb.ref("excluded.state"),
          checked_at: eb.ref("excluded.checked_at"),
          response_time_ms: eb.ref("excluded.response_time_ms"),
          error_class: eb.ref("excluded.error_class"),
          last_success_at: sql<Date | null>`coalesce(${eb.ref("excluded.last_success_at")}, ${eb.ref("integration_checks.last_success_at")})`,
        }))
        .where("integration_checks.checked_at", "<=", (eb) => eb.ref("excluded.checked_at")),
    )
    .execute();
}

/** Returns the instant of the newest stored check, or `undefined` when there is none. */
export async function latestCheckAt(db: Kysely<DB>): Promise<Date | undefined> {
  const row = await db
    .selectFrom("integration_checks")
    .select((eb) => eb.fn.max("checked_at").as("latest"))
    .executeTakeFirst();
  return row?.latest ?? undefined;
}

/** Returns what the screen shows for a stored state checked at `checkedAt`, read at `now`. */
export function displayState(
  state: CheckState,
  checkedAt: Date,
  now: Date,
): IntegrationDisplayState {
  return now.getTime() - checkedAt.getTime() > STALE_CHECK_MS ? "unknown" : state;
}

/**
 * Reads the latest check of every integration, in the fixed order of {@link INTEGRATIONS}: an
 * integration without a stored check shows as `not_checked`, one whose check is older than five
 * minutes as `unknown` (B3).
 */
export async function readIntegrationStatus(
  db: Kysely<DB>,
  now: Date,
): Promise<IntegrationStatusPage> {
  const rows = await db
    .selectFrom("integration_checks")
    .select([
      "integration",
      "state",
      "checked_at",
      "last_success_at",
      "response_time_ms",
      "error_class",
    ])
    .execute();
  const byIntegration = new Map<Integration, IntegrationStatus>();
  for (const row of rows) {
    const integration = parseIntegration(row.integration);
    const state = parseCheckState(row.state);
    const errorClass = row.error_class === null ? null : parseCheckErrorClass(row.error_class);
    if (!integration || !state || errorClass === undefined) {
      throw new IntegrationCheckInvalidError(`integration check ${row.integration} is invalid`);
    }
    byIntegration.set(integration, {
      integration,
      state: displayState(state, row.checked_at, now),
      checkedAt: row.checked_at.toISOString(),
      lastSuccessAt: row.last_success_at?.toISOString() ?? null,
      responseTimeMs: row.response_time_ms,
      errorClass,
    });
  }
  return {
    integrations: INTEGRATIONS.map(
      (integration) =>
        byIntegration.get(integration) ?? {
          integration,
          state: "not_checked",
          checkedAt: null,
          lastSuccessAt: null,
          responseTimeMs: null,
          errorClass: null,
        },
    ),
    readAt: now.toISOString(),
  };
}
