// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Which administrators can act (#345, second review of #356): a block holds up to and at its end,
// as the admin plugin judges a sign-in, and a deprovisioned administrator does not count.
import { describe, expect, it } from "vitest";
import { type AdministratorRow, isAvailable, isBlocked } from "./administrators.ts";

const NOW = new Date("2026-11-20T12:00:00Z");

function row(overrides: Partial<AdministratorRow>): AdministratorRow {
  return { id: "a1", banned: false, banExpires: null, deprovisioned_at: null, ...overrides };
}

describe("isBlocked (#356, N2)", () => {
  it("holds a block without an end", () => {
    expect(isBlocked(row({ banned: true }), NOW)).toBe(true);
  });

  it("holds a block that ends at this exact instant, and not one millisecond later", () => {
    const blocked = row({ banned: true, banExpires: NOW });
    expect(isBlocked(blocked, NOW)).toBe(true);
    expect(isBlocked(blocked, new Date(NOW.getTime() + 1))).toBe(false);
  });

  it("holds a block that ends later, not one that has ended", () => {
    expect(isBlocked(row({ banned: true, banExpires: new Date(NOW.getTime() + 1) }), NOW)).toBe(
      true,
    );
    expect(isBlocked(row({ banned: true, banExpires: new Date(NOW.getTime() - 1) }), NOW)).toBe(
      false,
    );
  });

  it("reads an unset or false ban as no block", () => {
    expect(isBlocked(row({ banned: null }), NOW)).toBe(false);
    expect(isBlocked(row({ banned: false, banExpires: NOW }), NOW)).toBe(false);
  });

  it("holds a block whose end is not a date, failing closed", () => {
    expect(isBlocked({ banned: true, banExpires: "not a date" }, NOW)).toBe(true);
  });

  it("reads an end given as a string, as the session carries it", () => {
    expect(isBlocked({ banned: true, banExpires: NOW.toISOString() }, NOW)).toBe(true);
  });
});

describe("isAvailable (#356, N3)", () => {
  it("counts an administrator who is neither blocked nor deprovisioned", () => {
    expect(isAvailable(row({}), NOW)).toBe(true);
  });

  it("does not count a deprovisioned administrator", () => {
    expect(isAvailable(row({ deprovisioned_at: new Date(NOW.getTime() - 1) }), NOW)).toBe(false);
  });

  it("does not count a blocked administrator", () => {
    expect(isAvailable(row({ banned: true }), NOW)).toBe(false);
  });
});
