// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { FieldApi, FormApi } from "@tanstack/react-form";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { baseLocale, overwriteGetLocale } from "@/i18n/runtime";
import { controlAfterMove } from "./array-move.ts";
import { dateToDay, dayToDate } from "./calendar-day.ts";
import { emailListSchema, parseEmailList } from "./email-list.ts";
import { errorMessages } from "./errors.ts";
import { applyServerRefusal } from "./server-refusal.ts";

afterEach(() => overwriteGetLocale(() => baseLocale));

describe("errorMessages", () => {
  it("reads strings, Standard Schema issues and nested arrays, once each and in order", () => {
    expect(
      errorMessages([
        "Enter a reason.",
        [{ message: "Too long." }, { message: "Enter a reason." }],
      ]),
    ).toEqual([{ message: "Enter a reason." }, { message: "Too long." }]);
  });

  it("skips empty slots of the error map and objects without a message", () => {
    expect(errorMessages([undefined, null, "", {}, { message: 3 }, { message: "" }])).toEqual([]);
  });
});

describe("calendar days", () => {
  it("turns a day into a local date at noon and back", () => {
    const date = dayToDate("2026-03-29");
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()]).toEqual([
      2026, 2, 29, 12,
    ]);
    expect(dateToDay(date)).toBe("2026-03-29");
  });

  it("pads months and days", () => {
    expect(dateToDay(new Date(2027, 0, 5, 12))).toBe("2027-01-05");
  });

  it("refuses a value that is not a day instead of guessing", () => {
    expect(() => dayToDate("29-03-2026")).toThrow(RangeError);
    expect(() => dayToDate("")).toThrow(RangeError);
  });
});

describe("parseEmailList", () => {
  it("splits on lines, commas and semicolons, trims and lower-cases", () => {
    expect(parseEmailList("A@Example.test, b@example.test;\nc@example.test\r\n")).toEqual([
      "a@example.test",
      "b@example.test",
      "c@example.test",
    ]);
  });

  it("reads the address of a mail client's Name <address> entry", () => {
    expect(parseEmailList("Test Student <student@example.test>, teacher@example.test")).toEqual([
      "student@example.test",
      "teacher@example.test",
    ]);
  });

  it("drops duplicates and addresses already in the list", () => {
    expect(
      parseEmailList("a@example.test a@example.test b@example.test", ["b@example.test"]),
    ).toEqual(["a@example.test"]);
  });

  it("keeps a malformed entry, so the schema names it", () => {
    expect(parseEmailList("not-an-address")).toEqual(["not-an-address"]);
  });
});

describe("emailListSchema", () => {
  const schema = emailListSchema(2);

  it("accepts valid addresses up to the maximum", () => {
    expect(schema.safeParse(["a@example.test", "b@example.test"]).success).toBe(true);
  });

  it("names every invalid address, on the list itself", () => {
    const result = schema.safeParse(["a@example.test", "nope"]);
    expect(result.error?.issues.map((i) => [i.path, i.message])).toEqual([
      [[], "nope is not a valid email address. Correct or remove it."],
    ]);
  });

  it("refuses more than the maximum", () => {
    const result = schema.safeParse(["a@example.test", "b@example.test", "c@example.test"]);
    expect(result.error?.issues.map((i) => i.message)).toEqual(["Enter at most 2 addresses."]);
  });

  it("says it in Dutch in the nl locale", () => {
    overwriteGetLocale(() => "nl");
    const result = schema.safeParse(["nope"]);
    expect(result.error?.issues.map((i) => i.message)).toEqual([
      "nope is geen geldig e-mailadres. Verbeter of verwijder het.",
    ]);
  });
});

describe("controlAfterMove", () => {
  it("keeps focus on the button that moved the row while it can move further", () => {
    expect(controlAfterMove(1, 3, "up")).toBe("up");
    expect(controlAfterMove(1, 3, "down")).toBe("down");
  });

  it("moves focus to the opposite button when the row reaches an edge", () => {
    expect(controlAfterMove(0, 3, "up")).toBe("down");
    expect(controlAfterMove(2, 3, "down")).toBe("up");
  });

  it("moves focus to remove when the row is alone", () => {
    expect(controlAfterMove(0, 1, "up")).toBe("remove");
  });
});

describe("applyServerRefusal", () => {
  function mountedForm() {
    // Every eduLIMS form validates with its shared schema; TanStack Form clears an `onServer`
    // error only in a form that has validators.
    const form = new FormApi({
      defaultValues: { reason: "", until: "" },
      validators: { onSubmit: z.object({ reason: z.string(), until: z.string() }) },
    });
    form.mount();
    const reason = new FieldApi({ form, name: "reason" });
    const until = new FieldApi({ form, name: "until" });
    reason.mount();
    until.mount();
    return { form, reason, until };
  }

  it("shows a refusal at the field it concerns and at the form", () => {
    const { form, reason, until } = mountedForm();
    applyServerRefusal(form, { form: "The server refused.", fields: { reason: "Too vague." } });
    expect(reason.state.meta.errors).toEqual(["Too vague."]);
    expect(until.state.meta.errors).toEqual([]);
    expect(form.state.errors).toEqual(["The server refused."]);
    expect(form.state.isValid).toBe(false);
  });

  it("clears the refusal at the next change, so a corrected value is never held back", () => {
    const { form, reason } = mountedForm();
    applyServerRefusal(form, { fields: { reason: "Too vague." } });
    reason.handleChange("Account shared with another person");
    expect(reason.state.meta.errors).toEqual([]);
    expect(form.state.isValid).toBe(true);
  });

  it("keeps the refusal through a value set without validation", () => {
    const { form, reason } = mountedForm();
    applyServerRefusal(form, { fields: { reason: "Too vague." } });
    form.setFieldValue("reason", "restored", { dontValidate: true, dontUpdateMeta: true });
    expect(reason.state.meta.errors).toEqual(["Too vague."]);
  });
});
