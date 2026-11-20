// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { m } from "@/i18n/messages";
import { ROLES } from "@/lib/roles";
import { THEMES } from "@/lib/theme";
import { roleLabel, rolesLabel, roleWriteErrorMessage, themeLabel } from "./labels";
import { inLocale } from "./test-helpers";

describe("roleLabel", () => {
  it("names the roles in English by default", () => {
    expect(ROLES.map(roleLabel)).toEqual(["Student", "Teacher", "Administrator"]);
  });

  it("names the roles in Dutch inside a Dutch request", async () => {
    const labels = await inLocale("nl", () => [roleLabel("teacher"), roleLabel("admin")]);
    const dutch = { locale: "nl" } as const;
    expect(labels).toEqual([m.role_teacher({}, dutch), m.role_admin({}, dutch)]);
    expect(labels).not.toEqual(["Teacher", "Administrator"]);
  });
});

describe("themeLabel", () => {
  it("names the themes in English and Dutch", async () => {
    expect(THEMES.map(themeLabel)).toEqual(["Light", "Dark", "System"]);
    expect(await inLocale("nl", () => THEMES.map(themeLabel))).toEqual([
      "Licht",
      "Donker",
      "Systeem",
    ]);
  });
});

describe("rolesLabel", () => {
  it("joins the display names of a role set", () => {
    expect(rolesLabel(["teacher", "admin"])).toBe("Teacher · Administrator");
  });
});

describe("roleWriteErrorMessage", () => {
  it("translates the refused role writes and nothing else", () => {
    expect(roleWriteErrorMessage("cannot_change_own_roles")).toBe(m.role_error_own_roles());
    expect(roleWriteErrorMessage("role_conflict")).toBe(m.role_error_not_allowed());
    expect(roleWriteErrorMessage("something else")).toBeNull();
    expect(roleWriteErrorMessage(undefined)).toBeNull();
  });
});
