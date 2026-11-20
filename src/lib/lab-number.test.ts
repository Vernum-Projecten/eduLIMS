// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The lab number (S12, R-11; maintainer, 2026-11-19 on #268): ten digits with a Damm check
// digit, so a typing mistake on the analyser matches no other sample.
import { describe, expect, it } from "vitest";
import {
  dammCheckDigit,
  formatLabNumber,
  isLabNumber,
  LAB_NUMBER_LENGTH,
  spellLabNumber,
  withCheckDigit,
} from "./lab-number.ts";

/** Invented nine-digit bodies spread over the range. */
const BODIES = ["100000000", "123456789", "987654321", "555555555", "908172635", "300000007"];

describe("the Damm check digit", () => {
  it("gives the published example: 572 checks with 4", () => {
    expect(dammCheckDigit("572")).toBe(4);
    expect(isLabNumber("5724")).toBe(false);
  });

  it("refuses an empty string and anything but digits", () => {
    expect(() => dammCheckDigit("")).toThrow(RangeError);
    expect(() => dammCheckDigit("12a")).toThrow(RangeError);
    expect(() => dammCheckDigit("１２")).toThrow(RangeError);
  });
});

describe("a lab number", () => {
  it("is ten digits whose check comes out at zero", () => {
    for (const body of BODIES) {
      const number = withCheckDigit(body);
      expect(number).toHaveLength(LAB_NUMBER_LENGTH);
      expect(number.startsWith(body)).toBe(true);
      expect(isLabNumber(number)).toBe(true);
    }
  });

  it("fits the 16 characters of the Afinion 2 patient ID", () => {
    expect(LAB_NUMBER_LENGTH).toBeLessThanOrEqual(16);
  });

  it("catches every single wrong digit (S12)", () => {
    for (const body of BODIES) {
      const number = withCheckDigit(body);
      for (let position = 0; position < number.length; position += 1) {
        for (let digit = 0; digit <= 9; digit += 1) {
          if (String(digit) === number[position]) continue;
          const typo = `${number.slice(0, position)}${digit}${number.slice(position + 1)}`;
          expect(isLabNumber(typo), typo).toBe(false);
        }
      }
    }
  });

  it("catches every swap of two neighbouring digits that differ (S12)", () => {
    for (const body of BODIES) {
      const number = withCheckDigit(body);
      for (let position = 0; position + 1 < number.length; position += 1) {
        const a = number[position] ?? "";
        const b = number[position + 1] ?? "";
        if (a === b) continue;
        const swapped = `${number.slice(0, position)}${b}${a}${number.slice(position + 2)}`;
        expect(isLabNumber(swapped), swapped).toBe(false);
      }
    }
  });

  it("is refused at nine or eleven digits, and with a space or a sign", () => {
    const number = withCheckDigit("123456789");
    expect(isLabNumber(number.slice(1))).toBe(false);
    expect(isLabNumber(`${number}0`)).toBe(false);
    expect(isLabNumber(formatLabNumber(number))).toBe(false);
    expect(isLabNumber(`+${number.slice(1)}`)).toBe(false);
  });

  it("needs a body of exactly nine digits", () => {
    expect(() => withCheckDigit("12345678")).toThrow(RangeError);
    expect(() => withCheckDigit("1234567890")).toThrow(RangeError);
    expect(() => withCheckDigit("12345678x")).toThrow(RangeError);
  });

  it("reads aloud in groups of three, three and four", () => {
    expect(formatLabNumber("1234567890")).toBe("123 456 7890");
  });

  it("spells digit by digit for a screen reader", () => {
    expect(spellLabNumber("1234567890")).toBe("1 2 3 4 5 6 7 8 9 0");
  });
});
