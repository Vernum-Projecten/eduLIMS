// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { readCookie } from "./cookies";
import {
  parseSidebarOpen,
  parseTheme,
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE,
  themeClass,
  themeCookie,
} from "./theme";

describe("readCookie", () => {
  it("finds a cookie among others", () => {
    expect(readCookie("a=1; EDULIMS_THEME=dark; b=2", THEME_COOKIE)).toBe("dark");
  });

  it("returns undefined for a missing cookie or header", () => {
    expect(readCookie("a=1", THEME_COOKIE)).toBeUndefined();
    expect(readCookie("", THEME_COOKIE)).toBeUndefined();
    expect(readCookie(undefined, THEME_COOKIE)).toBeUndefined();
    expect(readCookie(null, THEME_COOKIE)).toBeUndefined();
  });

  it("does not match a cookie whose name only ends with the name", () => {
    expect(readCookie("XEDULIMS_THEME=dark", THEME_COOKIE)).toBeUndefined();
  });

  it("skips a part without a value separator", () => {
    expect(readCookie("garbage; EDULIMS_THEME=light", THEME_COOKIE)).toBe("light");
  });

  it("decodes an escaped value and keeps a malformed one raw", () => {
    expect(readCookie("x=a%20b", "x")).toBe("a b");
    expect(readCookie("x=%E0%A4%A", "x")).toBe("%E0%A4%A");
  });
});

describe("parseTheme", () => {
  it.each(["light", "dark", "system"] as const)("accepts %s", (theme) => {
    expect(parseTheme(theme)).toBe(theme);
  });

  it.each([undefined, "", "DARK", "blue", 1])("falls back to system for %s", (value) => {
    expect(parseTheme(value)).toBe("system");
  });
});

describe("themeClass", () => {
  it("renders light and dark as a class and system as none", () => {
    expect(themeClass("light")).toBe("light");
    expect(themeClass("dark")).toBe("dark");
    expect(themeClass("system")).toBeUndefined();
  });
});

describe("themeCookie", () => {
  it("stores the theme site-wide for a year", () => {
    expect(themeCookie("dark", false)).toBe(
      `EDULIMS_THEME=dark; path=/; max-age=${THEME_COOKIE_MAX_AGE}; samesite=lax`,
    );
  });

  it("is secure over HTTPS", () => {
    expect(themeCookie("light", true)).toMatch(/; secure$/);
  });
});

describe("parseSidebarOpen", () => {
  it("is open by default and closed only for false", () => {
    expect(parseSidebarOpen(undefined)).toBe(true);
    expect(parseSidebarOpen("true")).toBe(true);
    expect(parseSidebarOpen("false")).toBe(false);
  });
});
