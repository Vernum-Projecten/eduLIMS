// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Running the integration check (B3, #35): on a schedule inside the app container, guarded by a
// PostgreSQL advisory lock so one replica checks, and on demand from the Admin portal. Both
// write the latest result per integration; the targets come from configuration only.
import "@tanstack/react-start/server-only";
import { type Kysely, sql } from "kysely";
import type { SessionUser } from "../authz.ts";
import { INTEGRATION_CHECK_LOCK_KEY } from "../db/advisory-locks.ts";
import type { DB } from "../db/schema.gen.ts";
import type { Env } from "../env.ts";
import { assertAdmin } from "../users/actions.ts";
import { type CheckResult, type ProbeDeps, probeAll, probeTargets } from "./probe.ts";
import {
  type IntegrationStatusPage,
  latestCheckAt,
  readIntegrationStatus,
  saveCheck,
} from "./store.ts";

// NOTE: B3 ("within 5 minutes"); our own interval: a failure shows at most one interval plus
// one check timeout plus one screen refresh after it starts, about 95 s.
export const CHECK_INTERVAL_MS = 60_000;

/** What a check runs with: the database, FerroBRIDGE's configuration and the clients. */
export interface CheckContext {
  db: Kysely<DB>;
  env: Pick<Env, "FERROBRIDGE_BASE_URL">;
  deps: ProbeDeps;
}

/** Checks every integration and stores the results in one transaction. */
export async function checkAndStore(ctx: CheckContext): Promise<CheckResult[]> {
  const results = await probeAll(probeTargets(ctx.env), ctx.deps);
  await ctx.db.transaction().execute(async (trx) => {
    for (const result of results) await saveCheck(trx, result);
  });
  return results;
}

/** Why a scheduled run did not check. */
export type ScheduledOutcome =
  | { checked: true; results: CheckResult[] }
  | { checked: false; reason: "locked" | "recent" };

/**
 * One scheduled run: it takes the advisory lock for the length of its transaction, and checks
 * only when no replica stored a check in the last half interval, so several replicas of the app
 * container check once per interval between them.
 */
export async function runScheduledCheck(ctx: CheckContext): Promise<ScheduledOutcome> {
  return ctx.db.transaction().execute(async (trx) => {
    const lock = await sql<{
      locked: boolean;
    }>`select pg_try_advisory_xact_lock(${INTEGRATION_CHECK_LOCK_KEY}) as locked`.execute(trx);
    if (lock.rows[0]?.locked !== true) return { checked: false, reason: "locked" };
    const latest = await latestCheckAt(trx);
    const now = ctx.deps.now();
    if (latest && now.getTime() - latest.getTime() < CHECK_INTERVAL_MS / 2) {
      return { checked: false, reason: "recent" };
    }
    const results = await probeAll(probeTargets(ctx.env), ctx.deps);
    for (const result of results) await saveCheck(trx, result);
    return { checked: true, results };
  });
}

/**
 * Starts the schedule: a run at once, then one every `intervalMs`. A run that is still busy
 * when the next is due is not doubled. The timer does not keep the process alive. Returns the
 * function that stops it.
 */
export function startCheckSchedule(
  run: () => Promise<unknown>,
  intervalMs: number = CHECK_INTERVAL_MS,
): () => void {
  let busy = false;
  const tick = () => {
    if (busy) return;
    busy = true;
    run()
      .catch((error: unknown) => {
        // NOTE: B3; a failed run (the database is down) must not stop the schedule, so it is
        // logged with its class only and the next tick tries again.
        const kind = error instanceof Error ? error.name : typeof error;
        console.error(`integration_check_failed kind=${kind}`);
      })
      .finally(() => {
        busy = false;
      });
  };
  tick();
  // NOTE: no requirement governs this: our own design. A fixed interval, not a debounce or
  // throttle, so TanStack Pacer has nothing to add here.
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

/** What the on-demand check runs with: a check context and the caller. */
export interface CheckNowContext extends CheckContext {
  actor: Pick<SessionUser, "roles">;
}

/**
 * Checks every integration now, for an administrator's "Check now", and returns the screen's
 * data. The targets are the configured ones: the caller has no say in them (ASVS V1.3.6).
 *
 * @throws AuthError 403 without the admin role.
 */
export async function checkNow(ctx: CheckNowContext): Promise<IntegrationStatusPage> {
  assertAdmin(ctx.actor);
  await checkAndStore(ctx);
  return readIntegrationStatus(ctx.db, ctx.deps.now());
}

/**
 * Returns the screen's data: the latest check of every integration.
 *
 * @throws AuthError 403 without the admin role.
 */
export async function readStatus(
  ctx: { db: Kysely<DB>; actor: Pick<SessionUser, "roles"> },
  now: Date,
): Promise<IntegrationStatusPage> {
  assertAdmin(ctx.actor);
  return await readIntegrationStatus(ctx.db, now);
}
