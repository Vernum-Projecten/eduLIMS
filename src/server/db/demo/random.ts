// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// A seeded pseudo-random source for the demo data, so every `pnpm db:seed` plans the same set.
// Not for anything secret: session tokens come from node:crypto in the writer.

const ALPHANUMERIC = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** A deterministic random source (mulberry32) with the helpers the demo plan needs. */
export interface DemoRandom {
  /** A float in [0, 1). */
  next(): number;
  /** An integer in [min, max]. */
  int(min: number, max: number): number;
  /** One element of a non-empty list. */
  pick<T>(items: readonly [T, ...T[]]): T;
  /** True with probability `p`. */
  chance(p: number): boolean;
  /** An id of `length` letters and digits, like better-auth's own ids. */
  id(length?: number): string;
  /** `length` lowercase hex digits. */
  hex(length: number): string;
}

/** Returns a {@link DemoRandom} that yields the same sequence for the same `seed`. */
export function demoRandom(seed: number): DemoRandom {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));
  const chars = (alphabet: string, length: number): string =>
    Array.from({ length }, () => alphabet.charAt(int(0, alphabet.length - 1))).join("");
  return {
    next,
    int,
    pick: (items) => items[int(0, items.length - 1)] ?? items[0],
    chance: (p) => next() < p,
    id: (length = 32) => chars(ALPHANUMERIC, length),
    hex: (length) => chars("0123456789abcdef", length),
  };
}
