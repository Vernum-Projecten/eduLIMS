// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { isRedirect, type ParsedLocation } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import type { SessionUser } from "@/server/authz";
import { requireRole, requireUser, safeRedirectPath } from "./guards";

const student: SessionUser = {
  id: "s1",
  name: "Sam",
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
    ["/docent", "/docent"],
    ["/student?tab=1", "/student?tab=1"],
    ["//evil.example", undefined],
    ["/\\evil.example", undefined],
    ["https://evil.example", undefined],
    ["docent", undefined],
    [undefined, undefined],
    [42, undefined],
  ])("%j -> %j", (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });
});

describe("requireUser", () => {
  const location = { href: "/docent" } as ParsedLocation;

  it("redirects anonymous visitors to /login and remembers the target", () => {
    const error = thrown(() => requireUser({ context: { user: null }, location }));
    expect(isRedirect(error)).toBe(true);
    expect(error).toMatchObject({ options: { to: "/login", search: { redirect: "/docent" } } });
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
    const error = thrown(() => requireRole("docent")({ context: { user: student } }));
    expect(isRedirect(error)).toBe(true);
    expect(error).toMatchObject({ options: { to: "/student" } });
  });

  it("sends users without any role home", () => {
    const error = thrown(() =>
      requireRole("beheerder")({ context: { user: { ...student, roles: [] } } }),
    );
    expect(error).toMatchObject({ options: { to: "/" } });
  });
});
