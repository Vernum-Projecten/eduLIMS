// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  breadcrumbFor,
  initials,
  navigationFor,
  normalizePath,
  PORTALS,
  portalNavigation,
  sectionOf,
} from "./navigation";

const paths = (roles: Parameters<typeof navigationFor>[0]) =>
  navigationFor(roles).flatMap((portal) => [
    portal.overview.to,
    ...portal.sections.map((section) => section.to),
  ]);

describe("navigationFor (B1: a user sees only the screens of their role)", () => {
  it("gives a student only the Student portal", () => {
    expect(navigationFor({ roles: ["student"] }).map((portal) => portal.role)).toEqual(["student"]);
    expect(paths({ roles: ["student"] }).every((path) => path.startsWith("/student"))).toBe(true);
  });

  it("gives a teacher only the Teacher portal", () => {
    expect(paths({ roles: ["teacher"] }).every((path) => path.startsWith("/teacher"))).toBe(true);
  });

  it("gives an administrator only the Admin portal", () => {
    expect(paths({ roles: ["admin"] }).every((path) => path.startsWith("/admin"))).toBe(true);
  });

  it("gives a user with several roles each of their portals, admin first", () => {
    expect(navigationFor({ roles: ["student", "admin"] }).map((portal) => portal.role)).toEqual([
      "admin",
      "student",
    ]);
  });

  it("gives no navigation without a user or a role", () => {
    expect(navigationFor(null)).toEqual([]);
    expect(navigationFor(undefined)).toEqual([]);
    expect(navigationFor({ roles: [] })).toEqual([]);
  });

  it("lists the agreed sections per portal", () => {
    const ids = (role: "student" | "teacher" | "admin") =>
      portalNavigation(role).sections.map((section) => section.id);
    expect(ids("student")).toEqual(["practicals", "samples", "results", "submissions", "grades"]);
    expect(ids("teacher")).toEqual([
      "practicals",
      "classes",
      "results",
      "grading",
      "kpi-dashboard",
    ]);
    expect(ids("admin")).toEqual(["users", "classes", "integrations", "activity"]);
  });

  it("keeps every path unique", () => {
    const all = PORTALS.flatMap((portal) => [portal.overview, ...portal.sections]).map(
      (item) => item.to,
    );
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("sectionOf", () => {
  it("returns the section of a portal", () => {
    expect(sectionOf("teacher", "grading").to).toBe("/teacher/grading");
  });
});

describe("normalizePath", () => {
  it("strips one trailing slash but keeps the root", () => {
    expect(normalizePath("/student/")).toBe("/student");
    expect(normalizePath("/student")).toBe("/student");
    expect(normalizePath("/")).toBe("/");
  });
});

describe("breadcrumbFor", () => {
  it("names the portal and the section", () => {
    const crumb = breadcrumbFor("/student/samples");
    expect(crumb?.portal.role).toBe("student");
    expect(crumb?.page.label()).toBe("Samples");
  });

  it("names the overview on a portal's home, with or without a trailing slash", () => {
    expect(breadcrumbFor("/admin/")?.page.id).toBe("overview");
    expect(breadcrumbFor("/admin")?.portal.label()).toBe("Admin portal");
  });

  it("returns null outside the portals", () => {
    expect(breadcrumbFor("/")).toBeNull();
    expect(breadcrumbFor("/login")).toBeNull();
    expect(breadcrumbFor("/student/unknown")).toBeNull();
  });
});

describe("initials", () => {
  it("takes the first letters of the first and last word", () => {
    expect(initials("Test Student")).toBe("TS");
    expect(initials("  language   test student ")).toBe("LS");
  });

  it("takes two letters of a single word", () => {
    expect(initials("admin")).toBe("AD");
  });

  it("falls back to a question mark for an empty name", () => {
    expect(initials("   ")).toBe("?");
  });
});
