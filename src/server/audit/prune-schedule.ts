// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The schedule of the retention prune inside the app container (B4, #65): operators run only the
// image, so no host cron job applies the retention periods.
import { envFields, parseWith } from "../env.ts";
import { logFailure } from "../security-log.ts";
import { PRUNE_FAILED_EVENT } from "./prune-job.ts";

/** How often the app container prunes (#65: every 24 hours). */
export const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

// NOTE: #65 ("once at start-up"); our own delay, so the first prune does not compete with the
// readiness check and the first requests of a fresh container.
export const PRUNE_FIRST_RUN_DELAY_MS = 60_000;

/** When the schedule runs: the delay of the first run and the interval after it. */
export interface PruneScheduleTiming {
  firstRunDelayMs: number;
  intervalMs: number;
}

const DEFAULT_TIMING: PruneScheduleTiming = {
  firstRunDelayMs: PRUNE_FIRST_RUN_DELAY_MS,
  intervalMs: PRUNE_INTERVAL_MS,
};

/**
 * Starts the schedule: a run after `firstRunDelayMs`, then one every `intervalMs`. A run still
 * busy when the next is due is not doubled, a run that throws is logged and the next interval
 * tries again, and the timers do not keep the process alive. Returns the function that stops it.
 */
export function startPruneSchedule(
  run: () => Promise<unknown>,
  timing: PruneScheduleTiming = DEFAULT_TIMING,
): () => void {
  let busy = false;
  const tick = () => {
    if (busy) return;
    busy = true;
    run()
      .catch((error: unknown) => {
        // NOTE: #65; a failed run must not stop the server or the schedule, so it is logged with
        // its cause chain (class names and codes only) and the next interval tries again.
        logFailure(PRUNE_FAILED_EVENT, error, { actor_type: "system" });
      })
      .finally(() => {
        busy = false;
      });
  };
  let interval: ReturnType<typeof setInterval> | undefined;
  const first = setTimeout(() => {
    tick();
    interval = setInterval(tick, timing.intervalMs);
    interval.unref();
  }, timing.firstRunDelayMs);
  first.unref();
  return () => {
    clearTimeout(first);
    if (interval !== undefined) clearInterval(interval);
  };
}

/** The part of the server's hooks the schedule needs: the `close` hook that stops it. */
export interface CloseHooks {
  hook(name: "close", fn: () => void): unknown;
}

/**
 * Starts the schedule with `run` when {@link pruneScheduleEnabled} says so for `source`, and
 * stops it on the server's `close` hook, so no timer outlives the server. Returns whether it
 * started.
 */
export function installPruneSchedule(
  hooks: CloseHooks,
  source: Record<string, string | undefined>,
  run: () => Promise<unknown>,
  timing: PruneScheduleTiming = DEFAULT_TIMING,
): boolean {
  if (!pruneScheduleEnabled(source)) return false;
  const stop = startPruneSchedule(run, timing);
  hooks.hook("close", stop);
  return true;
}

const nodeEnvOnly = envFields.pick({ NODE_ENV: true });

/**
 * Returns whether the app container schedules the prune: everywhere but `NODE_ENV=test`, so the
 * unit and e2e runs never prune each other's data. A test that needs the schedule calls
 * {@link startPruneSchedule} itself.
 */
export function pruneScheduleEnabled(source: Record<string, string | undefined>): boolean {
  return parseWith(nodeEnvOnly, source).NODE_ENV !== "test";
}
