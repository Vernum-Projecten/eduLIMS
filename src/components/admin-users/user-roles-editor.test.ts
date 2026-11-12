// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { roleRuledOut, toggleRole } from "./user-roles-editor";

describe("the role editor's allowed sets (ADR 0012)", () => {
  it("greys out teacher and administrator while student is checked", () => {
    expect(roleRuledOut(["student"], "teacher")).toBe(true);
    expect(roleRuledOut(["student"], "admin")).toBe(true);
    expect(roleRuledOut(["student"], "student")).toBe(false);
  });

  it("greys out student while teacher or administrator is checked", () => {
    expect(roleRuledOut(["teacher"], "student")).toBe(true);
    expect(roleRuledOut(["admin"], "student")).toBe(true);
    expect(roleRuledOut(["teacher"], "admin")).toBe(false);
    expect(roleRuledOut(["teacher", "admin"], "teacher")).toBe(false);
  });

  it("rules out nothing while no role is checked", () => {
    for (const role of ["student", "teacher", "admin"] as const) {
      expect(roleRuledOut([], role)).toBe(false);
    }
  });

  it("keeps a toggled set inside the allowed sets", () => {
    expect(toggleRole(["teacher"], "admin", true)).toEqual(["teacher", "admin"]);
    expect(toggleRole(["teacher", "admin"], "teacher", false)).toEqual(["admin"]);
    expect(toggleRole(["teacher"], "student", true)).toEqual(["student"]);
  });
});
