// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The supported UCUM units of the test catalogue (D9, #393; https://ucum.org/ucum).
import { describe, expect, it } from "vitest";
import { TEST_UNIT_MAX } from "./catalogue.ts";
import { isUcumCode, UCUM_CODES, UCUM_UNITS, ucumUnit, unitSymbol } from "./ucum.ts";

describe("the supported UCUM units (#393)", () => {
  it("lists every code once", () => {
    expect(new Set(UCUM_CODES).size).toBe(UCUM_CODES.length);
  });

  it("keeps every code within the column the database allows", () => {
    for (const code of UCUM_CODES) expect(code.length, code).toBeLessThanOrEqual(TEST_UNIT_MAX);
  });

  it("writes every code in UCUM's printable ASCII, without spaces", () => {
    for (const code of UCUM_CODES) expect(code, code).toMatch(/^[\x21-\x7E]+$/);
  });

  it("puts the common laboratory units first", () => {
    const kinds = UCUM_UNITS.map((entry) => entry.kind);
    expect(kinds.indexOf("other")).toBe(kinds.lastIndexOf("common") + 1);
  });

  it("covers the units the Afinion 2 documentation shows, and a ratio has none", () => {
    for (const code of ["%", "mg/L", "mg/dL", "mg/g", "mg/mmol", "mmol/L"]) {
      expect(isUcumCode(code), code).toBe(true);
    }
  });

  it("compares case-sensitively, as UCUM c/s does", () => {
    expect(isUcumCode("mmol/L")).toBe(true);
    expect(isUcumCode("mmol/l")).toBe(false);
    expect(isUcumCode("MMOL/L")).toBe(false);
    expect(isUcumCode("")).toBe(false);
    expect(isUcumCode("1")).toBe(false);
  });

  it("shows every supported unit by its symbol, and no unit as nothing (#404)", () => {
    expect(unitSymbol("10*9/L")).toBe("10⁹/L");
    expect(unitSymbol("[IU]/L")).toBe("IU/L");
    expect(unitSymbol("[pH]")).toBe("pH");
    expect(unitSymbol(null)).toBe("");
    for (const entry of UCUM_UNITS) expect(unitSymbol(entry.code)).toBe(entry.symbol);
  });

  it("prints µ for the micro prefix and keeps any other code as it is", () => {
    expect(unitSymbol("umol/L")).toBe("µmol/L");
    expect(unitSymbol("mmol/L")).toBe("mmol/L");
    expect(unitSymbol("furlong")).toBe("furlong");
    expect(ucumUnit("furlong")).toBeUndefined();
  });
});
