// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { isAsciiEmail, normalizeEmail, parseLabId, parseSimulationId } from "./simulations";

describe("the branded ids of simulations and labs", () => {
  it("brands a UUID in its text form, and nothing else", () => {
    const id = "01960000-0000-7000-8000-000000000001";
    expect(parseSimulationId(id)).toBe(id);
    expect(parseLabId(id)).toBe(id);
    for (const bad of [
      "",
      "not-a-uuid",
      `${id} `,
      "01960000-0000-7000-8000-00000000000A",
      "1 or 1=1",
    ]) {
      expect(parseSimulationId(bad)).toBeNull();
      expect(parseLabId(bad)).toBeNull();
    }
  });
});

describe("normalizeEmail", () => {
  it("trims and lower-cases an address, the one form lists store", () => {
    expect(normalizeEmail("  Ada.Lab@Example.TEST ")).toBe("ada.lab@example.test");
  });
});

describe("isAsciiEmail (#300 review, S4)", () => {
  it("takes a plain ASCII address, in any case", () => {
    expect(isAsciiEmail("Ada.Lab@Example.test")).toBe(true);
  });

  it("refuses an address that lower-casing could fold onto another", () => {
    expect(isAsciiEmail("Kelvin@example.test")).toBe(false);
    expect(isAsciiEmail("adа@example.test")).toBe(false);
  });

  it("refuses padding, spaces and a line that is no address", () => {
    expect(isAsciiEmail(" ada@example.test")).toBe(false);
    expect(isAsciiEmail("ada lab@example.test")).toBe(false);
    expect(isAsciiEmail("not-an-address")).toBe(false);
  });
});
