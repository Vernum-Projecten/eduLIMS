// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  autoSplitFormSchema,
  classFormSchema,
  classListSearchSchema,
  classPageSearchSchema,
  createGroupsFormSchema,
  INVITE_LIST_MAX,
  inviteFormSchema,
  inviteInput,
  moveStudentInput,
} from "./schemas.ts";

const ID = "01960000-0000-7000-8000-000000000001";

function messages(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.error?.issues.map((issue) => issue.message) ?? [];
}

describe("the class forms (#28), shared by the screens and the server functions", () => {
  it("takes a trimmed name and two consecutive years", () => {
    expect(classFormSchema.parse({ name: " LS-2A ", academicYear: "2026-2027" })).toEqual({
      name: "LS-2A",
      academicYear: "2026-2027",
    });
  });

  it("names the field it refuses, in words", () => {
    expect(messages(classFormSchema.safeParse({ name: " ", academicYear: "2026-2028" }))).toEqual([
      "Enter a class name.",
      "Enter two consecutive years, such as 2026-2027.",
    ]);
  });

  it("needs at least one address and at most the list maximum, any text per address", () => {
    expect(messages(inviteFormSchema.safeParse({ role: "student", emails: [] }))).toEqual([
      "Add at least one email address.",
    ]);
    const tooMany = Array.from({ length: INVITE_LIST_MAX + 1 }, (_, i) => `s${i}@example.test`);
    expect(inviteFormSchema.safeParse({ role: "student", emails: tooMany }).success).toBe(false);
    // NOTE: #28; a malformed address goes to the preview, which reports it.
    expect(inviteFormSchema.safeParse({ role: "teacher", emails: ["nope"] }).success).toBe(true);
    expect(inviteInput.safeParse({ classId: ID, role: "owner", emails: ["a"] }).success).toBe(
      false,
    );
  });

  it("bounds the group tools", () => {
    const groups = { groupSet: "Pairs", count: 0, prefix: "Group" };
    expect(messages(createGroupsFormSchema.safeParse(groups))).toEqual([
      "Enter a whole number from 1 to 50.",
    ]);
    const split = { groupSet: "Pairs", size: 2, order: "sideways", prefix: "Group" };
    expect(autoSplitFormSchema.safeParse(split).success).toBe(false);
    expect(
      moveStudentInput.safeParse({ classId: ID, userId: "u", groupSet: "Pairs", groupId: null })
        .success,
    ).toBe(true);
  });

  it("ignores a malformed archive filter or tab in the address", () => {
    expect(classListSearchSchema.parse({ archived: "yes" })).toEqual({ archived: undefined });
    expect(classPageSearchSchema.parse({ tab: "grades" })).toEqual({ tab: undefined });
    expect(classPageSearchSchema.parse({ tab: "groups" })).toEqual({ tab: "groups" });
  });
});
