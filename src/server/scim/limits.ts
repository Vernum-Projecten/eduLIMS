// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The limits of the SCIM endpoint (#45; API4, ASVS V2.4.1): a fixed-window rate limit and a
// body cap. A request whose token works counts against its provider; every other request
// (no token, an unknown, revoked or expired one) counts against its client IP, so guessing
// with fresh random tokens gains nothing. Relative imports: `pnpm db:seed` loads auth.ts.
import "@tanstack/react-start/server-only";

/** The limits of the SCIM endpoint. */
export interface ScimLimits {
  /** Requests one provider, or one client IP without a working token, may make per window. */
  maxRequests: number;
  windowMs: number;
  /** How many keys the limiter tracks at most; a new key past that is refused. */
  maxKeys: number;
  /** The largest request body accepted, in bytes. */
  maxBodyBytes: number;
}

// NOTE: no requirement governs the numbers: our own design, accepted by the owner on #45.
export const SCIM_LIMITS: ScimLimits = {
  maxRequests: 600,
  windowMs: 60_000,
  maxKeys: 10_000,
  maxBodyBytes: 1_048_576,
};

type Window = { start: number; count: number };

/**
 * Fixed-window counters in this process's memory: one table for providers (keys
 * `provider:<id>`, as many as there are providers with a working token) and one for client IPs
 * (every other key), bounded by `maxKeys`. Only the IP table fails closed when it is full, so
 * a flood of IP keys never locks a provider out (finding 1 of the second review).
 */
export class ScimRateLimiter {
  readonly #limits: Pick<ScimLimits, "maxRequests" | "windowMs" | "maxKeys">;
  readonly #providers = new Map<string, Window>();
  readonly #clients = new Map<string, Window>();

  constructor(limits: Pick<ScimLimits, "maxRequests" | "windowMs" | "maxKeys">) {
    this.#limits = limits;
  }

  #table(key: string): Map<string, Window> {
    return key.startsWith("provider:") ? this.#providers : this.#clients;
  }

  /**
   * Returns the seconds `key` must wait without counting a request: it is over its limit, or
   * it is a new client key while the client table is full of live windows. `null` to go on.
   */
  wait(key: string, now: number = Date.now()): number | null {
    const { windowMs, maxRequests, maxKeys } = this.#limits;
    const table = this.#table(key);
    const window = table.get(key);
    if (window && now - window.start < windowMs) {
      if (window.count < maxRequests) return null;
      return Math.max(1, Math.ceil((window.start + windowMs - now) / 1000));
    }
    if (!window && table === this.#clients && table.size >= maxKeys) {
      this.#prune(table, now);
      if (table.size >= maxKeys) return Math.ceil(windowMs / 1000);
    }
    return null;
  }

  /** Counts one request for `key`; returns the seconds to wait when it is over the limit. */
  hit(key: string, now: number = Date.now()): number | null {
    const blocked = this.wait(key, now);
    if (blocked !== null) return blocked;
    const table = this.#table(key);
    const window = table.get(key);
    if (window && now - window.start < this.#limits.windowMs) window.count += 1;
    else table.set(key, { start: now, count: 1 });
    return null;
  }

  #prune(table: Map<string, Window>, now: number): void {
    for (const [key, window] of table) {
      if (now - window.start >= this.#limits.windowMs) table.delete(key);
    }
  }
}

/** Returns the bearer token of a request, if it sends one. */
export function bearerOf(headers: Headers): string | null {
  const match = headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}

/**
 * Returns the rate-limit key of a request: its provider when its token works, else its client
 * IP as better-auth reads it (`advanced.ipAddress`), else one shared `unknown` bucket.
 */
export function rateKeyOf(providerId: string | null, clientIp: string | null): string {
  if (providerId !== null) return `provider:${providerId}`;
  return `ip:${clientIp ?? "unknown"}`;
}

/** Returns whether a request body is larger than `max` bytes, reading at most `max + 1`. */
export async function bodyTooLarge(request: Request, max: number): Promise<boolean> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return true;
  if (!request.body) return false;
  const reader = request.clone().body?.getReader();
  if (!reader) return false;
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return false;
    size += value.byteLength;
    if (size > max) {
      // NOTE: no requirement governs this: our own design; cancelling a tee'd clone waits for
      // the other branch, so the clone is released and dropped instead.
      reader.releaseLock();
      return true;
    }
  }
}
