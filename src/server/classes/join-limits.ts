// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The brute-force limit of joining with a code (#49; ASVS V2.4.1, V6.3.1): wrong codes are
// counted per user and per client IP in a fixed window, and a key over its limit is refused
// before the code is even looked up. Only wrong codes count, so a lab full of students behind
// one address joins without tripping the IP limit.
import "@tanstack/react-start/server-only";
import { JOIN_LIMIT_WINDOW_MINUTES } from "../../lib/join-code.ts";

/** The limits of one kind of key. */
export interface FailureLimit {
  /** Wrong codes a key may send per window; the next attempt is refused. */
  maxFailures: number;
  windowMs: number;
}

/** The limits of joining with a code, per user and per client IP. */
export interface JoinLimits {
  user: FailureLimit;
  ip: FailureLimit;
  /** How many keys the limiter tracks at most; a new key past that is refused (fail closed). */
  maxKeys: number;
}

// NOTE: no requirement governs these numbers: our own design, flagged on #49 for the owner.
export const JOIN_LIMITS: JoinLimits = {
  user: { maxFailures: 10, windowMs: JOIN_LIMIT_WINDOW_MINUTES * 60_000 },
  ip: { maxFailures: 50, windowMs: JOIN_LIMIT_WINDOW_MINUTES * 60_000 },
  maxKeys: 10_000,
};

/** The key of a user or of a client IP. */
export type LimitKey = { kind: "user"; id: string } | { kind: "ip"; address: string };

function keyOf(key: LimitKey): string {
  return key.kind === "user" ? `user:${key.id}` : `ip:${key.address}`;
}

/**
 * A fixed-window count of wrong codes per key, in this process's memory, with a bounded number
 * of keys. A restart forgets the counts; the code's 49 bits keep a fresh window useless.
 */
export class JoinFailureLimiter {
  readonly #limits: JoinLimits;
  readonly #windows = new Map<string, { start: number; failures: number }>();

  constructor(limits: JoinLimits = JOIN_LIMITS) {
    this.#limits = limits;
  }

  #limitOf(key: LimitKey): FailureLimit {
    return key.kind === "user" ? this.#limits.user : this.#limits.ip;
  }

  /** Returns whether any of `keys` is over its limit, or the limiter is full of live windows. */
  blocked(keys: readonly LimitKey[], now: number): boolean {
    return keys.some((key) => {
      const window = this.#windows.get(keyOf(key));
      const limit = this.#limitOf(key);
      if (!window) return this.#full(now);
      if (now - window.start >= limit.windowMs) return false;
      return window.failures >= limit.maxFailures;
    });
  }

  /**
   * Counts one wrong code for each of `keys`; returns whether one of them reached its limit with
   * this failure, so the caller records that moment once.
   */
  fail(keys: readonly LimitKey[], now: number): boolean {
    let reached = false;
    for (const key of keys) {
      const id = keyOf(key);
      const limit = this.#limitOf(key);
      const window = this.#windows.get(id);
      if (!window || now - window.start >= limit.windowMs) {
        if (!window && this.#full(now)) continue;
        this.#windows.set(id, { start: now, failures: 1 });
        reached ||= limit.maxFailures <= 1;
        continue;
      }
      window.failures += 1;
      reached ||= window.failures === limit.maxFailures;
    }
    return reached;
  }

  #full(now: number): boolean {
    if (this.#windows.size < this.#limits.maxKeys) return false;
    const longest = Math.max(this.#limits.user.windowMs, this.#limits.ip.windowMs);
    for (const [id, window] of this.#windows) {
      if (now - window.start >= longest) this.#windows.delete(id);
    }
    return this.#windows.size >= this.#limits.maxKeys;
  }
}

/** The one limiter of this server process. */
export const joinFailureLimiter = new JoinFailureLimiter();
