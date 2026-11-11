// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The schedule of the retention prune inside the app container (B4, #65), on fake timers.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installPruneSchedule,
  PRUNE_FIRST_RUN_DELAY_MS,
  PRUNE_INTERVAL_MS,
  pruneScheduleEnabled,
  startPruneSchedule,
} from "./prune-schedule.ts";

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("startPruneSchedule (#65)", () => {
  it("prunes every 24 hours", () => {
    expect(PRUNE_INTERVAL_MS).toBe(DAY);
  });

  it("calls the prune once shortly after start-up, then every 24 hours", async () => {
    const run = vi.fn(() => Promise.resolve());
    const stop = startPruneSchedule(run);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(PRUNE_FIRST_RUN_DELAY_MS);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(DAY - 1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(DAY);
    expect(run).toHaveBeenCalledTimes(3);
    stop();
  });

  it("logs a failed run with its cause and tries again at the next interval", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const run = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(
        new Error("prune failed", { cause: Object.assign(new Error("down"), { code: "57P01" }) }),
      )
      .mockResolvedValue(undefined);
    const stop = startPruneSchedule(run, { firstRunDelayMs: 10, intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(10);
    expect(error).toHaveBeenCalledWith("retention_prune_failed cause=Error <- Error(57P01)");
    await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledTimes(1);
    stop();
  });

  it("does not start a run while the previous one is still busy", async () => {
    let finish: () => void = () => {};
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const stop = startPruneSchedule(run, { firstRunDelayMs: 10, intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(210);
    expect(run).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });

  it("stops both timers, before and after the first run", async () => {
    const run = vi.fn(() => Promise.resolve());
    startPruneSchedule(run, { firstRunDelayMs: 10, intervalMs: 100 })();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).not.toHaveBeenCalled();

    const stop = startPruneSchedule(run, { firstRunDelayMs: 10, intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(10);
    stop();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("installPruneSchedule (#65)", () => {
  function fakeHooks() {
    const closers: Array<() => void> = [];
    return {
      closers,
      hooks: {
        hook: (_name: "close", fn: () => void) => {
          closers.push(fn);
        },
      },
    };
  }

  it("starts the schedule in production and stops it on the server's close hook", async () => {
    const { closers, hooks } = fakeHooks();
    const run = vi.fn(() => Promise.resolve());
    expect(installPruneSchedule(hooks, { NODE_ENV: "production" }, run)).toBe(true);
    await vi.advanceTimersByTimeAsync(PRUNE_FIRST_RUN_DELAY_MS);
    expect(run).toHaveBeenCalledTimes(1);
    expect(closers).toHaveLength(1);
    for (const close of closers) close();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(2 * DAY);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("schedules nothing under NODE_ENV=test", async () => {
    const { closers, hooks } = fakeHooks();
    const run = vi.fn(() => Promise.resolve());
    expect(installPruneSchedule(hooks, { NODE_ENV: "test" }, run)).toBe(false);
    await vi.advanceTimersByTimeAsync(2 * DAY);
    expect(run).not.toHaveBeenCalled();
    expect(closers).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("pruneScheduleEnabled (#65)", () => {
  it("runs the schedule in production and development", () => {
    expect(pruneScheduleEnabled({ NODE_ENV: "production" })).toBe(true);
    expect(pruneScheduleEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(pruneScheduleEnabled({})).toBe(true);
  });

  it("keeps the schedule off under NODE_ENV=test, so test runs never prune each other's data", () => {
    expect(pruneScheduleEnabled({ NODE_ENV: "test" })).toBe(false);
  });

  it("throws on an unknown NODE_ENV instead of guessing", () => {
    expect(() => pruneScheduleEnabled({ NODE_ENV: "staging" })).toThrow(/NODE_ENV/);
  });
});
