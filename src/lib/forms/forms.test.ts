// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { FieldApi, FormApi, revalidateLogic } from "@tanstack/react-form";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { baseLocale, overwriteGetLocale } from "@/i18n/runtime";
import { controlAfterMove } from "./array-move.ts";
import { dateToDay, dayToDate } from "./calendar-day.ts";
import { emailListSchema, parseEmailList } from "./email-list.ts";
import { errorMessages } from "./errors.ts";
import { applyServerRefusal, formRefusal, keepServerRefusals } from "./server-refusal.ts";

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
    expect(formRefusal(form, form.state)?.message).toBe("The server refused.");
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

describe("server refusals with the eduLIMS validation logic (#120)", () => {
  const schema = z.object({ reason: z.string().min(1), until: z.string() });

  function refusedForm() {
    const submitted: string[] = [];
    const refusal: { form?: string; fields?: { reason: string } } = {};
    const form = new FormApi({
      defaultValues: { reason: "Too short", until: "" },
      validationLogic: keepServerRefusals(revalidateLogic()),
      validators: { onDynamic: schema },
      onSubmit: ({ value, formApi }) => {
        submitted.push(value.reason);
        applyServerRefusal(formApi, refusal);
      },
    });
    form.mount();
    const reason = new FieldApi({ form, name: "reason" });
    const until = new FieldApi({ form, name: "until" });
    reason.mount();
    until.mount();
    return { form, reason, until, submitted, refusal };
  }

  async function refuseField() {
    const parts = refusedForm();
    parts.refusal.fields = { reason: "Too vague." };
    await parts.form.handleSubmit();
    expect(parts.reason.state.meta.errors).toEqual(["Too vague."]);
    return parts;
  }

  async function refuseForm() {
    const parts = refusedForm();
    parts.refusal.form = "The server refused.";
    await parts.form.handleSubmit();
    expect(formRefusal(parts.form, parts.form.state)?.message).toBe("The server refused.");
    return parts;
  }

  it("keeps a field refusal when a field loses focus", async () => {
    const { reason, until } = await refuseField();
    reason.handleBlur();
    until.handleBlur();
    expect(reason.state.meta.errors).toEqual(["Too vague."]);
  });

  it("keeps a field refusal when another field changes", async () => {
    const { reason, until } = await refuseField();
    until.handleChange("2026-12-01");
    expect(reason.state.meta.errors).toEqual(["Too vague."]);
  });

  it("clears a field refusal when that field changes", async () => {
    const { form, reason } = await refuseField();
    reason.handleChange("Account shared with another person");
    expect(reason.state.meta.errors).toEqual([]);
    expect(form.state.canSubmit).toBe(true);
  });

  it("keeps a field refusal through a value set without validation", async () => {
    const { form, reason } = await refuseField();
    form.setFieldValue("reason", "restored", { dontValidate: true, dontUpdateMeta: true });
    reason.handleBlur();
    expect(reason.state.meta.errors).toEqual(["Too vague."]);
  });

  it("submits an unchanged value again after a field refusal", async () => {
    const { form, submitted } = await refuseField();
    await form.handleSubmit();
    expect(submitted).toEqual(["Too short", "Too short"]);
  });

  it("still holds a submit back for a schema error after a field refusal", async () => {
    const { form, reason, submitted } = await refuseField();
    reason.handleChange("");
    await form.handleSubmit();
    expect(submitted).toEqual(["Too short"]);
  });

  it("keeps a form refusal when a field loses focus", async () => {
    const { form, reason } = await refuseForm();
    reason.handleBlur();
    expect(formRefusal(form, form.state)?.message).toBe("The server refused.");
  });

  it("clears a form refusal when a field changes", async () => {
    const { form, until } = await refuseForm();
    until.handleChange("2026-12-01");
    expect(formRefusal(form, form.state)).toBeUndefined();
  });

  it("clears a form refusal when the form is submitted again", async () => {
    const { form, refusal } = await refuseForm();
    delete refusal.form;
    await form.handleSubmit();
    expect(formRefusal(form, form.state)).toBeUndefined();
  });

  it("numbers each form refusal, so the same message given again is a new refusal", async () => {
    const { form } = await refuseForm();
    const first = formRefusal(form, form.state)?.sequence;
    await form.handleSubmit();
    const second = formRefusal(form, form.state);
    expect(second?.message).toBe("The server refused.");
    expect(second?.sequence).not.toBe(first);
  });

  it("forgets a form refusal when a refusal without one is applied", async () => {
    const { form } = await refuseForm();
    applyServerRefusal(form, {});
    expect(formRefusal(form, form.state)).toBeUndefined();
  });
});
