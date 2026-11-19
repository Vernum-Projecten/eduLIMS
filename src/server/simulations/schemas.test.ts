// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  JOIN_CODE_DAYS_MAX,
  JOIN_CODE_INPUT_MAX,
  JOIN_CODE_USES_MAX,
} from "../../lib/join-code.ts";
import {
  EMAIL_LINE_MAX,
  EMAIL_LIST_MAX,
  LAB_NAME_MAX,
  SIMULATION_NAME_MAX,
} from "../../lib/simulations.ts";
import {
  addTeacherFormSchema,
  addTeacherInput,
  createLabInput,
  emailListFormSchema,
  emailListInput,
  joinCodeFormSchema,
  joinCodeInput,
  joinFormSchema,
  joinInput,
  labIdInput,
  moveMemberFormSchema,
  moveMemberInput,
  simulationFormSchema,
  simulationIdInput,
} from "./schemas.ts";

const ID = "01960000-0000-7000-8000-000000000001";

describe("the simulation inputs (D10)", () => {
  it("refuses a malformed id before any query runs", () => {
    expect(simulationIdInput.safeParse({ simulationId: "1 or 1=1" }).success).toBe(false);
    expect(labIdInput.safeParse({ labId: "../x" }).success).toBe(false);
    expect(moveMemberInput.safeParse({ simulationId: ID, userId: "u", labId: "x" }).success).toBe(
      false,
    );
  });

  it("trims a name, refuses an empty one in words and holds the length bounds", () => {
    expect(simulationFormSchema.parse({ name: "  Spring run " })).toEqual({ name: "Spring run" });
    const empty = simulationFormSchema.safeParse({ name: "   " });
    expect(empty.error?.issues[0]?.message).toBe("Enter a name for the simulation.");
    expect(
      simulationFormSchema.safeParse({ name: "x".repeat(SIMULATION_NAME_MAX + 1) }).success,
    ).toBe(false);
    expect(createLabInput.safeParse({ simulationId: ID, name: "" }).error?.issues[0]?.message).toBe(
      "Enter a name for the lab.",
    );
    expect(
      createLabInput.safeParse({ simulationId: ID, name: "x".repeat(LAB_NAME_MAX + 1) }).success,
    ).toBe(false);
  });

  it("takes any line of a pasted list, up to the limit: the server classifies each", () => {
    expect(emailListInput.safeParse({ labId: ID, emails: ["not an address"] }).success).toBe(true);
    expect(emailListInput.safeParse({ labId: ID, emails: [] }).success).toBe(false);
    expect(
      emailListInput.safeParse({ labId: ID, emails: Array(EMAIL_LIST_MAX + 1).fill("a@b.test") })
        .success,
    ).toBe(false);
  });

  it("takes a well-formed address for a new teacher", () => {
    expect(addTeacherInput.safeParse({ simulationId: ID, email: " t@example.test " }).success).toBe(
      true,
    );
    expect(addTeacherInput.safeParse({ simulationId: ID, email: "teacher" }).success).toBe(false);
  });
});

describe("the form schemas share the server's rules, with messages in words (ADR 0011)", () => {
  it("refuses a malformed teacher address with a translated message", () => {
    const result = addTeacherFormSchema.safeParse({ email: "teacher" });
    expect(result.error?.issues[0]?.message).toBe(
      "Enter an email address, such as name@example.org.",
    );
    expect(addTeacherFormSchema.parse({ email: " t@example.test " })).toEqual({
      email: "t@example.test",
    });
  });

  it("refuses an empty pasted list with a translated message, and keeps a malformed line", () => {
    expect(emailListFormSchema.safeParse({ emails: [] }).error?.issues[0]?.message).toBe(
      "Enter at least one email address.",
    );
    expect(emailListFormSchema.safeParse({ emails: ["not an address"] }).success).toBe(true);
  });

  it("refuses a pasted line over the limit and a list over the limit in words", () => {
    const long = emailListFormSchema.safeParse({
      emails: ["ok@example.test", `${"x".repeat(EMAIL_LINE_MAX)}@example.test`],
    });
    // The issue belongs to the list, so the list field shows it (WCAG 3.3.1), and names the line.
    expect(long.error?.issues).toEqual([
      expect.objectContaining({
        path: ["emails"],
        message: `The line “${"x".repeat(24)}…” is longer than ${EMAIL_LINE_MAX} characters.`,
      }),
    ]);
    expect(emailListFormSchema.safeParse({ emails: ["x".repeat(EMAIL_LINE_MAX)] }).success).toBe(
      true,
    );
    const many = emailListFormSchema.safeParse({
      emails: Array(EMAIL_LIST_MAX + 1).fill("a@b.test"),
    });
    expect(many.error?.issues[0]?.message).toBe(`Enter at most ${EMAIL_LIST_MAX} addresses.`);
  });

  it("asks for the lab a student moves to", () => {
    expect(moveMemberFormSchema.safeParse({ labId: "" }).error?.issues[0]?.message).toBe(
      "Choose the lab the student moves to.",
    );
    expect(moveMemberFormSchema.safeParse({ labId: ID }).success).toBe(true);
  });
});

describe("the lab-code schemas (S10, #290)", () => {
  it("keeps the database's bounds for the term and the joins, in words (#288)", () => {
    expect(joinCodeFormSchema.safeParse({ validDays: 1, maxUses: 1 }).success).toBe(true);
    expect(
      joinCodeFormSchema.safeParse({ validDays: JOIN_CODE_DAYS_MAX, maxUses: JOIN_CODE_USES_MAX })
        .success,
    ).toBe(true);
    expect(
      joinCodeFormSchema.safeParse({ validDays: JOIN_CODE_DAYS_MAX + 1, maxUses: 1 }).error
        ?.issues[0]?.message,
    ).toBe(`Enter a whole number of days from 1 to ${JOIN_CODE_DAYS_MAX}.`);
    expect(
      joinCodeFormSchema.safeParse({ validDays: 7, maxUses: 0 }).error?.issues[0]?.message,
    ).toBe(`Enter a whole number of students from 1 to ${JOIN_CODE_USES_MAX}.`);
    // An empty number field gives NaN, which is refused with the same words.
    expect(
      joinCodeFormSchema.safeParse({ validDays: Number.NaN, maxUses: 1 }).error?.issues[0]?.message,
    ).toBe(`Enter a whole number of days from 1 to ${JOIN_CODE_DAYS_MAX}.`);
    expect(joinCodeFormSchema.safeParse({ validDays: 1.5, maxUses: 1 }).success).toBe(false);
  });

  it("the server's input is the form plus the lab, and refuses a malformed lab id", () => {
    expect(joinCodeInput.safeParse({ labId: ID, validDays: 7, maxUses: 100 }).success).toBe(true);
    expect(joinCodeInput.safeParse({ labId: "x", validDays: 7, maxUses: 100 }).success).toBe(false);
  });

  it("asks for a code, and refuses one of the wrong shape before the server is asked", () => {
    expect(joinFormSchema.safeParse({ code: "  " }).error?.issues[0]?.message).toBe(
      "Enter the lab code your teacher gave you.",
    );
    expect(joinFormSchema.safeParse({ code: "ABC" }).error?.issues[0]?.message).toBe(
      "A lab code has 10 letters and digits, such as ABCDE-FGH23.",
    );
    expect(
      joinFormSchema.safeParse({ code: "x".repeat(JOIN_CODE_INPUT_MAX + 1) }).error?.issues[0]
        ?.message,
    ).toBe("A lab code has 10 letters and digits, such as ABCDE-FGH23.");
    expect(joinFormSchema.safeParse({ code: "abcde fgh23" }).success).toBe(true);
  });

  it("the server takes any string up to the maximum, so a crafted code is still charged", () => {
    expect(joinInput.safeParse({ code: "" }).success).toBe(true);
    expect(joinInput.safeParse({ code: "x".repeat(JOIN_CODE_INPUT_MAX + 1) }).success).toBe(false);
  });
});
