// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { randomInt } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  formatJoinCode,
  generateJoinCode,
  JOIN_CODE_ALPHABET,
  JOIN_CODE_INPUT_MAX,
  JOIN_CODE_LENGTH,
  normalizeJoinCode,
} from "./join-code";

describe("the join-code alphabet (#49)", () => {
  it("has no lookalike characters", () => {
    for (const lookalike of ["0", "O", "1", "I", "L"]) {
      expect(JOIN_CODE_ALPHABET).not.toContain(lookalike);
    }
    expect(new Set(JOIN_CODE_ALPHABET).size).toBe(JOIN_CODE_ALPHABET.length);
  });

  it("gives a code of at least 40 bits", () => {
    const bits = JOIN_CODE_LENGTH * Math.log2(JOIN_CODE_ALPHABET.length);
    expect(bits).toBeGreaterThanOrEqual(40);
  });

  it("fits a formatted code in the form's maximum", () => {
    expect(formatJoinCode("A".repeat(JOIN_CODE_LENGTH)).length).toBeLessThanOrEqual(
      JOIN_CODE_INPUT_MAX,
    );
  });
});

describe("generateJoinCode", () => {
  it("draws every symbol from the alphabet", () => {
    const code = generateJoinCode(randomInt);
    expect(code).toMatch(new RegExp(`^[${JOIN_CODE_ALPHABET}]{${JOIN_CODE_LENGTH}}$`));
  });

  it("maps each random index to its symbol", () => {
    let next = 0;
    const code = generateJoinCode(() => next++);
    expect(code).toBe(JOIN_CODE_ALPHABET.slice(0, JOIN_CODE_LENGTH));
  });

  it("refuses an index out of range", () => {
    expect(() => generateJoinCode(() => JOIN_CODE_ALPHABET.length)).toThrow(RangeError);
  });
});

describe("normalizeJoinCode", () => {
  it("accepts small letters, dashes and spaces", () => {
    expect(normalizeJoinCode(" abcde-fgh23 ")).toBe("ABCDEFGH23");
    expect(normalizeJoinCode("ABCDE FGH23")).toBe("ABCDEFGH23");
  });

  it.each([
    ["too short", "ABCDE-FGH2"],
    ["too long", "ABCDE-FGH234"],
    ["a lookalike O", "ABCDE-FGHO3"],
    ["a zero", "ABCDE-FGH03"],
    ["a punctuation mark", "ABCDE.FGH23"],
    ["empty", ""],
  ])("refuses a code that is %s", (_case, typed) => {
    expect(normalizeJoinCode(typed)).toBeNull();
  });
});

describe("formatJoinCode", () => {
  it("groups the code in fives", () => {
    expect(formatJoinCode("ABCDEFGH23")).toBe("ABCDE-FGH23");
  });

  it("round-trips through normalizeJoinCode", () => {
    const code = generateJoinCode(randomInt);
    expect(normalizeJoinCode(formatJoinCode(code))).toBe(code);
  });
});
