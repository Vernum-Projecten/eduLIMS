// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  type ClassPermission,
  type ClassRole,
  classCan,
  isAcademicYear,
  isClassRole,
  isTeachingRole,
  memberPermission,
  nextAcademicYear,
} from "./classes.ts";

describe("the class roles of #28", () => {
  const cases: [ClassPermission, Record<ClassRole, boolean>][] = [
    [{ class: ["update"] }, { owner: true, teacher: false, student: false }],
    [{ class: ["archive"] }, { owner: true, teacher: false, student: false }],
    [{ class: ["delete"] }, { owner: true, teacher: false, student: false }],
    [{ class: ["copy"] }, { owner: true, teacher: false, student: false }],
    [{ class: ["transfer"] }, { owner: true, teacher: false, student: false }],
    [{ student: ["invite"] }, { owner: true, teacher: true, student: false }],
    [{ student: ["remove"] }, { owner: true, teacher: true, student: false }],
    // Owner decision on #28 (3): only the owner invites co-teachers.
    [{ coTeacher: ["invite"] }, { owner: true, teacher: false, student: false }],
    [{ coTeacher: ["remove"] }, { owner: true, teacher: false, student: false }],
    // Owner decision on #28 (9): students never manage groups.
    [{ group: ["manage"] }, { owner: true, teacher: true, student: false }],
  ];

  it.each(cases)("%o is allowed as %o", (permission, expected) => {
    for (const role of ["owner", "teacher", "student"] as const) {
      expect([role, classCan(role, permission)]).toEqual([role, expected[role]]);
    }
  });

  it("maps an invitation role to its permission", () => {
    expect(memberPermission("teacher", "invite")).toEqual({ coTeacher: ["invite"] });
    expect(memberPermission("student", "remove")).toEqual({ student: ["remove"] });
  });

  it("knows its roles and which of them teach", () => {
    expect(isClassRole("owner")).toBe(true);
    expect(isClassRole("member")).toBe(false);
    expect(isClassRole(undefined)).toBe(false);
    expect(isTeachingRole("owner")).toBe(true);
    expect(isTeachingRole("teacher")).toBe(true);
    expect(isTeachingRole("student")).toBe(false);
  });
});

describe("academic years", () => {
  it.each([
    ["2026-2027", true],
    ["2026-2028", false],
    ["2027-2026", false],
    ["2026/2027", false],
    ["26-27", false],
    ["", false],
  ])("%s is an academic year: %s", (value, expected) => {
    expect(isAcademicYear(value)).toBe(expected);
  });

  it("gives the next academic year", () => {
    expect(nextAcademicYear("2026-2027")).toBe("2027-2028");
  });
});
