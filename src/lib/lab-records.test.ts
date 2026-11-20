// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The vocabulary of a team's records (S11, S12, S16): ids, kinds, sexes and the one date rule
// the form holds, refusing only a date that is no date.
import { describe, expect, it } from "vitest";
import {
  isIsoDate,
  parsePatientId,
  parsePatientSex,
  parseRequestId,
  parseRequestKind,
  parseSampleId,
} from "./lab-records.ts";

const ID = "01960000-0000-7000-8000-0000000000ab";

describe("the record ids", () => {
  it("parse a UUID and refuse anything else", () => {
    for (const parse of [parsePatientId, parseRequestId, parseSampleId]) {
      expect(parse(ID)).toBe(ID);
      expect(parse("not-a-uuid")).toBeNull();
      expect(parse(ID.toUpperCase())).toBeNull();
    }
  });
});

describe("the kinds and sexes", () => {
  it("know a patient request and a control request (S16)", () => {
    expect(parseRequestKind("patient")).toBe("patient");
    expect(parseRequestKind("control")).toBe("control");
    expect(parseRequestKind("urgent")).toBeUndefined();
  });

  it("know the sexes a form gives (S11)", () => {
    expect(parsePatientSex("female")).toBe("female");
    expect(parsePatientSex("unknown")).toBe("unknown");
    expect(parsePatientSex("F")).toBeUndefined();
  });
});

describe("isIsoDate (S11: only a date that is no date is refused)", () => {
  it("takes calendar dates, a leap day in a leap year included", () => {
    expect(isIsoDate("1984-03-21")).toBe(true);
    expect(isIsoDate("2000-02-29")).toBe(true);
    expect(isIsoDate("2024-02-29")).toBe(true);
  });

  it("takes a date in the future: the team checks the form, eduLIMS does not", () => {
    expect(isIsoDate("2099-12-31")).toBe(true);
  });

  it("refuses a day the calendar does not have", () => {
    expect(isIsoDate("2023-02-29")).toBe(false);
    expect(isIsoDate("1900-02-29")).toBe(false);
    expect(isIsoDate("2024-04-31")).toBe(false);
    expect(isIsoDate("2024-13-01")).toBe(false);
    expect(isIsoDate("2024-00-10")).toBe(false);
    expect(isIsoDate("0000-01-01")).toBe(false);
  });

  it("refuses another notation", () => {
    expect(isIsoDate("21-03-1984")).toBe(false);
    expect(isIsoDate("1984-3-21")).toBe(false);
    expect(isIsoDate("1984-03-21T00:00")).toBe(false);
    expect(isIsoDate("")).toBe(false);
  });
});
