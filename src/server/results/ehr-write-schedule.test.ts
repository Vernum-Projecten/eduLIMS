// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The retry schedule of the pending result writes (#148): it runs every interval, never two runs
// at once, logs a run that throws and goes on, stops when told, and runs nowhere under NODE_ENV=test.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { securityLines } from "../simulations/test-helpers.ts";
import {
  RESULT_WRITE_INTERVAL_MS,
  RESULT_WRITE_RUN_FAILED_EVENT,
  resultWriteScheduleEnabled,
  startResultWriteSchedule,
} from "./ehr-write-schedule.ts";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("startResultWriteSchedule (#148)", () => {
  it("runs once every interval and stops when told", async () => {
    const run = vi.fn(async () => undefined);
    const stop = startResultWriteSchedule(run);
    await vi.advanceTimersByTimeAsync(RESULT_WRITE_INTERVAL_MS * 2);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(RESULT_WRITE_INTERVAL_MS * 2);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("starts no run while the last one is busy", async () => {
    let finish: () => void = () => {};
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const stop = startResultWriteSchedule(run, 1_000);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(run).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });

  it("logs a run that throws and runs again at the next interval", async () => {
    const run = vi.fn(async () => {
      throw new Error("database down");
    });
    const lines = await securityLines(async () => {
      const stop = startResultWriteSchedule(run, 1_000);
      await vi.advanceTimersByTimeAsync(2_000);
      stop();
    });
    expect(run).toHaveBeenCalledTimes(2);
    expect(lines).toEqual([
      expect.objectContaining({ event: RESULT_WRITE_RUN_FAILED_EVENT }),
      expect.objectContaining({ event: RESULT_WRITE_RUN_FAILED_EVENT }),
    ]);
  });
});

describe("resultWriteScheduleEnabled", () => {
  it.each([
    ["test", false],
    ["development", true],
    ["production", true],
  ] as const)("NODE_ENV=%s runs the schedule: %s", (env, enabled) => {
    expect(resultWriteScheduleEnabled({ NODE_ENV: env })).toBe(enabled);
  });

  it("runs it when NODE_ENV is unset (fail safe as production)", () => {
    expect(resultWriteScheduleEnabled({})).toBe(true);
  });
});
