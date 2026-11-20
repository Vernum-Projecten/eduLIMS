// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The schedule that retries the pending writes of released results to FerroEHR inside the app
// container (#148): operators run only the image, so no host cron job is needed. The row lease in
// `runPendingResultWrites` lets several replicas run it at once without writing a row twice.
import "@tanstack/react-start/server-only";
import { envFields, parseWith } from "../env.ts";
import { logFailure } from "../security-log.ts";

// NOTE: no openEHR spec governs this: our own design (#148); a pending result is tried again
// within a minute of its pause ending.
export const RESULT_WRITE_INTERVAL_MS = 60_000;

/** The security-log event of a retry run that threw. */
export const RESULT_WRITE_RUN_FAILED_EVENT = "ferroehr_result_retry_failed";

/**
 * Starts the schedule: `run` every `intervalMs`, never two at once. A run that throws is logged
 * and the next interval tries again; the timer does not keep the process alive. Returns the
 * function that stops it.
 */
export function startResultWriteSchedule(
  run: () => Promise<unknown>,
  intervalMs: number = RESULT_WRITE_INTERVAL_MS,
): () => void {
  let busy = false;
  const interval = setInterval(() => {
    if (busy) return;
    busy = true;
    run()
      .catch((error: unknown) => {
        // NOTE: #148; a failed run must not stop the server or the schedule, so it is logged
        // with its cause chain (class names and codes only) and the next interval tries again.
        logFailure(RESULT_WRITE_RUN_FAILED_EVENT, error, { actor_type: "system" });
      })
      .finally(() => {
        busy = false;
      });
  }, intervalMs);
  interval.unref();
  return () => clearInterval(interval);
}

const nodeEnvOnly = envFields.pick({ NODE_ENV: true });

/**
 * Returns whether the app container schedules the retries: everywhere but `NODE_ENV=test`, so
 * the unit and e2e runs never write each other's results. A test calls the run itself.
 */
export function resultWriteScheduleEnabled(source: Record<string, string | undefined>): boolean {
  return parseWith(nodeEnvOnly, source).NODE_ENV !== "test";
}
