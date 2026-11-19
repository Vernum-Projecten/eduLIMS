// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { normalizeEmail, parseLabId, parseSimulationId } from "./simulations";

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
