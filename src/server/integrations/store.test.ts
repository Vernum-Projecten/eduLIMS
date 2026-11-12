// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The stored steps of the integration check and its activity-log rows (B3, B4, #227).
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import type { CheckResult } from "./probe.ts";
import { readIntegrationStatus, saveCheck } from "./store.ts";

const NOW = new Date("2026-11-12T12:00:00Z");
const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function database(): Promise<Kysely<DB>> {
  db ??= await createTestDb();
  return db;
}

function ferroehr(
  overrides: Partial<CheckResult> = {},
  detail: Partial<NonNullable<CheckResult["ferroehr"]>> = {},
): CheckResult {
  return {
    integration: "ferroehr",
    state: "available",
    checkedAt: NOW,
    responseTimeMs: 40,
    errorClass: null,
    ferrobridge: null,
    ferroehr: {
      steps: { reachable: "passed", signed_in: "passed", template_loaded: "passed" },
      serverVersion: "5.7.0",
      specVersion: "1.1.0",
      signInTarget: null,
      authReason: null,
      ...detail,
    },
    ...overrides,
  };
}

const REFUSED = ferroehr(
  { state: "refused", errorClass: "auth_refused", checkedAt: at(60) },
  {
    steps: { reachable: "passed", signed_in: "refused", template_loaded: "skipped" },
    signInTarget: "token_endpoint",
    authReason: "invalid_client",
  },
);

function bridge(overrides: Partial<CheckResult> = {}): CheckResult {
  return {
    integration: "ferrobridge",
    state: "not_ready",
    checkedAt: NOW,
    responseTimeMs: 12,
    errorClass: "readiness_down",
    ferroehr: null,
    ferrobridge: { phase: "serving", failingIndicators: ["terminology", "cdr"] },
    ...overrides,
  };
}

async function events(database: Kysely<DB>) {
  return database
    .selectFrom("audit_event")
    .select(["actor_type", "actor_id", "outcome", "target_type", "target_id", "reason_code"])
    .select("metadata")
    .where("action", "=", "integration_state_changed")
    .orderBy("occurred_at")
    .execute();
}

describe("saveCheck and readIntegrationStatus: the steps (#227)", () => {
  it("stores and reads FerroEHR's steps, versions and refusal code", async () => {
    const database_ = await database();
    await saveCheck(database_, REFUSED);
    const [status] = (await readIntegrationStatus(database_, at(60))).integrations;
    expect(status).toMatchObject({
      state: "refused",
      errorClass: "auth_refused",
      ferrobridge: null,
      ferroehr: {
        steps: { reachable: "passed", signed_in: "refused", template_loaded: "skipped" },
        serverVersion: "5.7.0",
        specVersion: "1.1.0",
        signInTarget: "token_endpoint",
        authReason: "invalid_client",
      },
    });
  });

  it("stores and reads FerroBRIDGE's phase and failing indicators", async () => {
    const database_ = await database();
    await saveCheck(database_, bridge());
    const status = (await readIntegrationStatus(database_, NOW)).integrations[1];
    expect(status).toMatchObject({
      state: "not_ready",
      errorClass: "readiness_down",
      ferroehr: null,
      ferrobridge: { phase: "serving", failingIndicators: ["terminology", "cdr"] },
    });
  });
});

describe("saveCheck: the activity log (B4, #227)", () => {
  it("logs the first check as a change from not checked, by eduLIMS, codes only", async () => {
    const database_ = await database();
    expect(await saveCheck(database_, ferroehr())).toBe(true);
    expect(await events(database_)).toEqual([
      {
        actor_type: "system",
        actor_id: null,
        outcome: "success",
        target_type: "integration",
        target_id: "ferroehr",
        reason_code: null,
        metadata: { check_state: "available", previous_check_state: "not_checked" },
      },
    ]);
  });

  it("does not log a check that keeps the state", async () => {
    const database_ = await database();
    await saveCheck(database_, ferroehr());
    expect(await saveCheck(database_, ferroehr({ checkedAt: at(60) }))).toBe(false);
    expect(await events(database_)).toHaveLength(1);
  });

  it("logs a refusal with its class, the failed step and the refusal code", async () => {
    const database_ = await database();
    await saveCheck(database_, ferroehr());
    await saveCheck(database_, REFUSED);
    expect((await events(database_)).at(-1)).toEqual({
      actor_type: "system",
      actor_id: null,
      outcome: "failure",
      target_type: "integration",
      target_id: "ferroehr",
      reason_code: "auth_refused",
      metadata: {
        check_state: "refused",
        previous_check_state: "available",
        check_step: "signed_in",
        auth_reason: "invalid_client",
      },
    });
  });

  it("logs a move of the failure to another step under the same state and class", async () => {
    const database_ = await database();
    const unreachable = { state: "unavailable", errorClass: "unreachable" } as const;
    await saveCheck(
      database_,
      ferroehr(unreachable, {
        steps: { reachable: "failed", signed_in: "skipped", template_loaded: "skipped" },
      }),
    );
    await saveCheck(
      database_,
      ferroehr(
        { ...unreachable, checkedAt: at(60) },
        { steps: { reachable: "passed", signed_in: "failed", template_loaded: "skipped" } },
      ),
    );
    const steps = (await events(database_)).map((event) => event.metadata);
    expect(steps).toEqual([
      expect.objectContaining({ check_step: "reachable" }),
      expect.objectContaining({ check_step: "signed_in", previous_check_state: "unavailable" }),
    ]);
  });

  it("logs a missing template as not ready at the template step", async () => {
    const database_ = await database();
    await saveCheck(
      database_,
      ferroehr(
        { state: "not_ready", errorClass: "template_missing" },
        { steps: { reachable: "passed", signed_in: "passed", template_loaded: "missing" } },
      ),
    );
    expect((await events(database_))[0]).toMatchObject({
      outcome: "failure",
      reason_code: "template_missing",
      metadata: { check_state: "not_ready", check_step: "template_loaded" },
    });
  });

  it("neither stores nor logs a result older than the stored one", async () => {
    const database_ = await database();
    await saveCheck(database_, REFUSED);
    expect(await saveCheck(database_, ferroehr({ checkedAt: NOW }))).toBe(false);
    expect((await readIntegrationStatus(database_, at(60))).integrations[0]?.state).toBe("refused");
    expect(await events(database_)).toHaveLength(1);
  });
});

describe("the integration_checks constraints (#227)", () => {
  const row = {
    integration: "ferroehr",
    state: "available",
    checked_at: NOW,
    reachable: "passed",
    signed_in: "passed",
    template_loaded: "passed",
  };

  it.each([
    [
      "not ready without its class",
      { state: "not_ready" },
      /integration_checks_(error_state|not_ready)/,
    ],
    [
      "not ready with a class of another state",
      { state: "not_ready", error_class: "unreachable" },
      /integration_checks_not_ready/,
    ],
    [
      "a missing template class on an available state",
      { error_class: "template_missing" },
      /integration_checks_(error_state|not_ready)/,
    ],
    ["FerroEHR without its steps", { template_loaded: null }, /integration_checks_steps/],
    ["an unknown step state", { reachable: "maybe" }, /integration_checks_step_states/],
    ["a version that is free text", { server_version: "5.7 beta" }, /integration_checks_versions/],
    ["a refusal code without a refusal", { auth_reason: "x" }, /integration_checks_auth_reason/],
    ["readiness on FerroEHR", { readiness_phase: "serving" }, /integration_checks_readiness/],
  ])("refuses %s", async (_name, change, constraint) => {
    const database_ = await database();
    await expect(
      database_
        .insertInto("integration_checks")
        .values({ ...row, ...change })
        .execute(),
    ).rejects.toThrow(constraint);
  });

  it("refuses an indicator name that is not a code", async () => {
    const database_ = await database();
    await expect(
      database_
        .insertInto("integration_checks")
        .values({
          integration: "ferrobridge",
          state: "not_ready",
          error_class: "readiness_down",
          checked_at: NOW,
          failing_indicators: ["Bad Name"],
        })
        .execute(),
    ).rejects.toThrow(/integration_checks_failing_indicators/);
  });
});
