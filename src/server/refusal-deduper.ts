// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// One log line per key and window for a burst of the same refusal (ASVS V16.2.5), so a flood of
// refused requests cannot fill the log. Relative imports: `pnpm db:seed` loads auth.ts.
import "@tanstack/react-start/server-only";

/**
 * Remembers which refusals were logged in the current window, bounded: the refused SCIM tokens
 * (#45, L2) and the refused request bodies (#350).
 */
export class RefusalDeduper {
  readonly #windowMs: number;
  readonly #maxKeys: number;
  #seen = new Map<string, { at: number; suppressed: number }>();

  constructor(windowMs = 60_000, maxKeys = 10_000) {
    this.#windowMs = windowMs;
    this.#maxKeys = maxKeys;
  }

  /**
   * Returns how many refusals of `key` the row logged now stands for (this one and those left
   * out since the last row), or `null` when `key` was logged within the window.
   */
  next(key: string, now: number = Date.now()): number | null {
    const seen = this.#seen.get(key);
    if (seen !== undefined && now - seen.at < this.#windowMs) {
      seen.suppressed += 1;
      return null;
    }
    if (seen === undefined && this.#seen.size >= this.#maxKeys) {
      for (const [key, entry] of this.#seen) {
        if (now - entry.at >= this.#windowMs) this.#seen.delete(key);
      }
      // NOTE: #45 (L2); when every slot is live the oldest goes, so logging never stops.
      if (this.#seen.size >= this.#maxKeys) {
        const oldest = this.#seen.keys().next();
        if (!oldest.done) this.#seen.delete(oldest.value);
      }
    }
    this.#seen.set(key, { at: now, suppressed: 0 });
    return 1 + (seen?.suppressed ?? 0);
  }

  /** Returns whether `key` should be logged at `now`: once per window. */
  first(key: string, now: number = Date.now()): boolean {
    return this.next(key, now) !== null;
  }
}
