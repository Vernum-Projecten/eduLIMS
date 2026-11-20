// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The translated common names of the supported units (#393, ADR 0011).
import { describe, expect, it } from "vitest";
import { UCUM_CODES } from "@/lib/ucum";
import { inLocale } from "./test-helpers";
import { ucumName, unitLabel, unitOptions } from "./unit-labels";

describe("unit labels (#393)", () => {
  it.each(["en", "nl"] as const)(
    "gives every supported unit its own name in %s",
    async (locale) => {
      const names = await inLocale(locale, () => UCUM_CODES.map((code) => ucumName(code)));
      expect(names.every((name) => name.trim() !== "")).toBe(true);
      expect(new Set(names).size).toBe(names.length);
    },
  );

  it("shows the symbol with its common name, in the active language", async () => {
    expect(await inLocale("en", () => unitLabel("mmol/L"))).toBe("mmol/L (millimole per litre)");
    expect(await inLocale("en", () => unitLabel("umol/L"))).toBe("µmol/L (micromole per litre)");
    expect(await inLocale("nl", () => unitLabel("mmol/L"))).toBe("mmol/L (millimol per liter)");
  });

  it("shows no unit in words, and a code outside the list as it is", async () => {
    expect(await inLocale("en", () => unitLabel(null))).toBe("No unit");
    expect(await inLocale("nl", () => unitLabel(null))).toBe("Geen eenheid");
    expect(unitLabel("furlong")).toBe("furlong");
  });

  it("offers every unit as a choice, searchable by its code", () => {
    const options = unitOptions();
    expect(options.map((option) => option.value)).toEqual(UCUM_CODES);
    expect(options.find((option) => option.value === "umol/L")?.keywords).toBe("umol/L");
  });
});
