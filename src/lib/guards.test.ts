// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { isRedirect, type ParsedLocation } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import type { SessionUser } from "@/server/authz";
import { requireRole, requireUser, safeRedirectPath } from "./guards";

const student: SessionUser = {
  id: "s1",
  name: "Test Student",
  email: "student@example.test",
  roles: ["student"],
};

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}

describe("safeRedirectPath", () => {
  it.each([
    ["/teacher", "/teacher"],
    ["/student?tab=1", "/student?tab=1"],
    ["//evil.example", undefined],
    ["/\\evil.example", undefined],
    ["https://evil.example", undefined],
    ["/teacher/grading?practical=3#rubric", "/teacher/grading?practical=3#rubric"],
    ["/\t/evil.example", undefined],
    ["/\n/evil.example", undefined],
    ["/\r/evil.example", undefined],
    ["/ /evil.example", undefined],
    [" /teacher", undefined],
    ["/teacher\\..\\..\\evil", undefined],
    ["/\u0000/evil.example", undefined],
    ["/%09/evil.example", "/%09/evil.example"],
    ["teacher", undefined],
    [undefined, undefined],
    [42, undefined],
  ])("%j -> %j", (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });
});

describe("requireUser", () => {
  const location = { href: "/teacher" } as ParsedLocation;

  it("redirects anonymous visitors to /login and remembers the target", () => {
    const error = thrown(() => requireUser({ context: { user: null }, location }));
    expect(isRedirect(error)).toBe(true);
    expect(error).toMatchObject({ options: { to: "/login", search: { redirect: "/teacher" } } });
  });

  it("narrows the context to a signed-in user", () => {
    expect(requireUser({ context: { user: student }, location })).toEqual({ user: student });
  });
});

describe("requireRole", () => {
  it("lets users with the role through", () => {
    expect(() => requireRole("student")({ context: { user: student } })).not.toThrow();
  });

  it("sends users without the role to their own portal", () => {
    const error = thrown(() => requireRole("teacher")({ context: { user: student } }));
    expect(isRedirect(error)).toBe(true);
    expect(error).toMatchObject({ options: { to: "/student" } });
  });

  it("sends users without any role home", () => {
    const error = thrown(() =>
      requireRole("admin")({ context: { user: { ...student, roles: [] } } }),
    );
    expect(error).toMatchObject({ options: { to: "/" } });
  });
});
