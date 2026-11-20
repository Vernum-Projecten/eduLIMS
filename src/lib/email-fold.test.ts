// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The address helpers behind the sign-in refusal of #324 (ASVS 5.0 V6.8.1). An unfolded KELVIN
// SIGN address reaches no create-user payload (better-auth lower-cases it first), so these cases
// live here, on the helpers, and the gate tests use the folded payload better-auth produces.
import { describe, expect, it } from "vitest";
import { foldsOntoAscii } from "./email-fold";
import { isAsciiEmail } from "./simulations";

const KELVIN = "Kim@example.test";

describe("foldsOntoAscii (#324)", () => {
  it("flags an address that lower-casing folds onto a plain ASCII one", () => {
    expect(KELVIN.toLowerCase()).toBe("kim@example.test");
    expect(foldsOntoAscii(KELVIN)).toBe(true);
    expect(foldsOntoAscii("ada.Kelvin@Example.TEST")).toBe(true);
  });

  it("lets a plain ASCII address through, in any case", () => {
    expect(foldsOntoAscii("Kim@Example.test")).toBe(false);
    expect(foldsOntoAscii("")).toBe(false);
  });

  it("lets through an address that stays non-ASCII after lower-casing", () => {
    expect(foldsOntoAscii("josé@school.example")).toBe(false);
    expect(foldsOntoAscii("JOSÉ@school.example")).toBe(false);
    expect(foldsOntoAscii("Kim.josé@school.example")).toBe(false);
    expect(foldsOntoAscii("adа@example.test")).toBe(false);
  });
});

describe("isAsciiEmail, the second line behind the refusal (#311 finding 3)", () => {
  it("never takes an unfolded KELVIN SIGN address for a lab's list or an admin grant", () => {
    expect(isAsciiEmail(KELVIN)).toBe(false);
  });

  it("never takes josé@school.example either", () => {
    expect(isAsciiEmail("josé@school.example")).toBe(false);
  });
});
