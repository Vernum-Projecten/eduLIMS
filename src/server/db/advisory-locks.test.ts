// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { ADVISORY_LOCK_KEYS } from "./advisory-locks.ts";

describe("the advisory lock registry", () => {
  const values = Object.values(ADVISORY_LOCK_KEYS);

  it("gives every lock its own key", () => {
    expect(new Set(values).size).toBe(values.length);
  });

  it("holds keys PostgreSQL takes as one bigint, exactly in a JavaScript number", () => {
    for (const value of values) expect(Number.isSafeInteger(value)).toBe(true);
  });
});
