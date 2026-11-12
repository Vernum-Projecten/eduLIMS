// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The latest check result per integration (B3, #35, #227), in `integration_checks`: written by
// every check, read by the Admin portal's status screen. A change of state writes an
// `integration_state_changed` row to the activity log in the same transaction, codes only.
import "@tanstack/react-start/server-only";
import { type Kysely, type Selectable, sql } from "kysely";
import {
  type CheckErrorClass,
  type CheckState,
  FERROEHR_STEPS,
  type FerroBridgeDetail,
  type FerroEhrDetail,
  type FerroEhrStep,
  failedStep,
  INTEGRATIONS,
  type Integration,
  type IntegrationDisplayState,
  parseCheckErrorClass,
  parseCheckState,
  parseIntegration,
  parseReadinessPhase,
  parseSignInTarget,
  parseStepState,
  STALE_CHECK_MS,
} from "../../lib/integrations.ts";
import { recordAudit } from "../audit/record.ts";
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
  /** FerroEHR's steps; `null` for FerroBRIDGE and before the first check. */
  ferroehr: FerroEhrDetail | null;
  /** FerroBRIDGE's readiness; `null` for FerroEHR and before the first check. */
  ferrobridge: FerroBridgeDetail | null;
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

/** What decides whether a check changed the state: the state, its class and the failed step. */
function stateKey(state: string, errorClass: string | null, step: string | null): string {
  return `${state}/${errorClass ?? "-"}/${step ?? "-"}`;
}

/** Returns the FerroEHR step that failed in a result, or `null`. */
function resultStep(result: CheckResult): FerroEhrStep | null {
  return result.ferroehr ? failedStep(result.ferroehr.steps) : null;
}

/**
 * Stores one check result as the integration's latest. A success also becomes its last success;
 * a failure keeps the last success it had. An older result never replaces a newer one, so two
 * checks that finish out of order leave the later one. When the state, its error class or the
 * failed FerroEHR step changes, it writes an `integration_state_changed` activity-log row.
 *
 * Pass a transaction, so the row and its log entry commit together.
 *
 * @returns whether the result changed the stored state.
 * @throws AuditWriteError when the activity-log row cannot be written.
 */
export async function saveCheck(db: Kysely<DB>, result: CheckResult): Promise<boolean> {
  const previous = await db
    .selectFrom("integration_checks")
    .select(["state", "error_class", "checked_at", "reachable", "signed_in", "template_loaded"])
    .where("integration", "=", result.integration)
    .forUpdate()
    .executeTakeFirst();
  if (previous && previous.checked_at.getTime() > result.checkedAt.getTime()) return false;
  const available = result.state === "available";
  const ehr = result.ferroehr;
  const bridge = result.ferrobridge;
  const values = {
    state: result.state,
    checked_at: result.checkedAt,
    response_time_ms: result.responseTimeMs,
    error_class: result.errorClass,
    reachable: ehr?.steps.reachable ?? null,
    signed_in: ehr?.steps.signed_in ?? null,
    template_loaded: ehr?.steps.template_loaded ?? null,
    server_version: ehr?.serverVersion ?? null,
    spec_version: ehr?.specVersion ?? null,
    sign_in_target: ehr?.signInTarget ?? null,
    auth_reason: ehr?.authReason ?? null,
    readiness_phase: bridge?.phase ?? null,
    failing_indicators: bridge ? [...bridge.failingIndicators] : null,
  };
  await db
    .insertInto("integration_checks")
    .values({
      integration: result.integration,
      last_success_at: available ? result.checkedAt : null,
      ...values,
    })
    .onConflict((oc) =>
      oc.column("integration").doUpdateSet({
        ...values,
        last_success_at: sql<Date | null>`coalesce(excluded.last_success_at, integration_checks.last_success_at)`,
      }),
    )
    .execute();
  const step = resultStep(result);
  const previousStep = previous
    ? (FERROEHR_STEPS.find((name) => previous[name] !== null && previous[name] !== "passed") ??
      null)
    : null;
  const changed =
    !previous ||
    stateKey(previous.state, previous.error_class, previousStep) !==
      stateKey(result.state, result.errorClass, step);
  if (!changed) return false;
  const previousState = previous ? parseCheckState(previous.state) : "not_checked";
  const authReason = ehr?.authReason ?? null;
  // NOTE: B4 and ASVS V16.2.5: the row holds codes only; eduLIMS observed the change, so it acts.
  await recordAudit(db, {
    action: "integration_state_changed",
    actor: { type: "system" },
    outcome: available ? "success" : "failure",
    target: { type: "integration", id: result.integration },
    ...(result.errorClass ? { reason: result.errorClass } : {}),
    occurredAt: result.checkedAt,
    metadata: {
      check_state: result.state,
      ...(previousState ? { previous_check_state: previousState } : {}),
      ...(step ? { check_step: step } : {}),
      ...(authReason ? { auth_reason: authReason } : {}),
    },
  });
  return true;
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

const COLUMNS = [
  "integration",
  "state",
  "checked_at",
  "last_success_at",
  "response_time_ms",
  "error_class",
  "reachable",
  "signed_in",
  "template_loaded",
  "server_version",
  "spec_version",
  "sign_in_target",
  "auth_reason",
  "readiness_phase",
  "failing_indicators",
] as const;

type Row = Pick<Selectable<DB["integration_checks"]>, (typeof COLUMNS)[number]>;

function invalid(row: { integration: string }): IntegrationCheckInvalidError {
  return new IntegrationCheckInvalidError(`integration check ${row.integration} is invalid`);
}

/** Returns FerroEHR's stored steps and codes, or throws when a stored value is invalid. */
function ferroEhrDetail(row: Row): FerroEhrDetail {
  const reachable = parseStepState(row.reachable);
  const signedIn = parseStepState(row.signed_in);
  const templateLoaded = parseStepState(row.template_loaded);
  const signInTarget = row.sign_in_target === null ? null : parseSignInTarget(row.sign_in_target);
  if (!reachable || !signedIn || !templateLoaded || signInTarget === undefined) throw invalid(row);
  return {
    steps: { reachable, signed_in: signedIn, template_loaded: templateLoaded },
    serverVersion: row.server_version,
    specVersion: row.spec_version,
    signInTarget,
    authReason: row.auth_reason,
  };
}

/** Returns FerroBRIDGE's stored readiness, or throws when a stored value is invalid. */
function ferroBridgeDetail(row: Row): FerroBridgeDetail {
  const phase = row.readiness_phase === null ? null : parseReadinessPhase(row.readiness_phase);
  if (phase === undefined) throw invalid(row);
  return { phase, failingIndicators: row.failing_indicators ?? [] };
}

/**
 * Reads the latest check of every integration, in the fixed order of {@link INTEGRATIONS}: an
 * integration without a stored check shows as `not_checked`, one whose check is older than five
 * minutes as `unknown` (B3).
 *
 * @throws IntegrationCheckInvalidError when a stored row holds a value outside the vocabulary.
 */
export async function readIntegrationStatus(
  db: Kysely<DB>,
  now: Date,
): Promise<IntegrationStatusPage> {
  const rows = await db.selectFrom("integration_checks").select(COLUMNS).execute();
  const byIntegration = new Map<Integration, IntegrationStatus>();
  for (const row of rows) {
    const integration = parseIntegration(row.integration);
    const state = parseCheckState(row.state);
    const errorClass = row.error_class === null ? null : parseCheckErrorClass(row.error_class);
    if (!integration || !state || errorClass === undefined) throw invalid(row);
    byIntegration.set(integration, {
      integration,
      state: displayState(state, row.checked_at, now),
      checkedAt: row.checked_at.toISOString(),
      lastSuccessAt: row.last_success_at?.toISOString() ?? null,
      responseTimeMs: row.response_time_ms,
      errorClass,
      ferroehr: integration === "ferroehr" ? ferroEhrDetail(row) : null,
      ferrobridge: integration === "ferrobridge" ? ferroBridgeDetail(row) : null,
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
          ferroehr: null,
          ferrobridge: null,
        },
    ),
    readAt: now.toISOString(),
  };
}
