// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { devPagesEnabled } from "./dev-tools.ts";

describe("devPagesEnabled", () => {
  it("serves the development pages in development", () => {
    expect(devPagesEnabled({ NODE_ENV: "development" })).toBe(true);
  });

  it("serves the development pages in test, which the e2e suite runs", () => {
    expect(devPagesEnabled({ NODE_ENV: "test" })).toBe(true);
  });

  it("refuses the development pages in production", () => {
    expect(devPagesEnabled({ NODE_ENV: "production" })).toBe(false);
  });

  it("refuses the development pages when NODE_ENV is unset or blank, which counts as production", () => {
    expect(devPagesEnabled({})).toBe(false);
    expect(devPagesEnabled({ NODE_ENV: " " })).toBe(false);
  });

  it("throws on an unknown NODE_ENV instead of guessing", () => {
    expect(() => devPagesEnabled({ NODE_ENV: "staging" })).toThrow(/NODE_ENV/);
  });
});
