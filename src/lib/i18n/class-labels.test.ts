// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { CLASS_ROLES } from "@/lib/classes";
import { CLASS_ACTION_ERRORS } from "@/server/classes/access";
import { INVITE_ROW_STATUSES } from "@/server/classes/invitations";
import { classErrorMessage, classRoleLabel, inviteRowStatusLabel } from "./class-labels";

describe("class labels (#28)", () => {
  it("names every class role", () => {
    expect(CLASS_ROLES.map(classRoleLabel)).toEqual(["Owner", "Co-teacher", "Student"]);
  });

  it("gives every refusal of the class service its own message", () => {
    const messages = CLASS_ACTION_ERRORS.map(classErrorMessage);
    expect(new Set(messages).size).toBe(CLASS_ACTION_ERRORS.length);
    expect(messages).not.toContain(classErrorMessage(null));
    expect(classErrorMessage("unknown")).toBe("That did not work. Try again.");
  });

  it("names every preview status, the wrong role per class role", () => {
    for (const status of INVITE_ROW_STATUSES) {
      expect(inviteRowStatusLabel(status, "student")).not.toBe("");
    }
    expect(inviteRowStatusLabel("wrong_role", "teacher")).toBe(
      "This account is not a teacher account",
    );
    expect(inviteRowStatusLabel("no_account", "teacher")).toBe(
      "No account yet: ask your colleague to sign in to eduLIMS once, then invite them",
    );
    expect(inviteRowStatusLabel("wrong_role", "student")).toBe(
      "This account is not a student account",
    );
  });
});
