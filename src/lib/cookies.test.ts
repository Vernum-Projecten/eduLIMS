// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { HOST_COOKIE_PREFIX, hostCookieName, preferenceCookie } from "./cookies";
import { localeCookie, localeFromCookies } from "./i18n/locale-cookie";
import { SIDEBAR_COOKIE_MAX_AGE, sidebarCookie, themeCookie } from "./theme";

describe("hostCookieName (#43, ASVS V3.3.3)", () => {
  it("prefixes __Host- over https", () => {
    expect(hostCookieName("EDULIMS_THEME", true)).toBe("__Host-EDULIMS_THEME");
    expect(HOST_COOKIE_PREFIX).toBe("__Host-");
  });

  it("keeps the bare name over plain http (development)", () => {
    expect(hostCookieName("EDULIMS_THEME", false)).toBe("EDULIMS_THEME");
  });
});

describe("preferenceCookie", () => {
  it("meets the __Host- rules over https: Secure, Path=/ and no Domain", () => {
    const cookie = preferenceCookie("X", "1", 60, true);
    expect(cookie).toBe("__Host-X=1; path=/; max-age=60; samesite=lax; secure");
    expect(cookie).not.toMatch(/domain=/i);
  });

  it("is a plain site-wide cookie over http", () => {
    expect(preferenceCookie("X", "1", 60, false)).toBe("X=1; path=/; max-age=60; samesite=lax");
  });
});

describe("the preference cookies over https", () => {
  it("prefix the theme, sidebar and locale cookies", () => {
    expect(themeCookie("dark", true)).toMatch(/^__Host-EDULIMS_THEME=dark; path=\/;.*; secure$/);
    expect(sidebarCookie(false, true)).toBe(
      `__Host-EDULIMS_SIDEBAR=false; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}; samesite=lax; secure`,
    );
    expect(localeCookie("nl", true)).toMatch(/^__Host-EDULIMS_LOCALE=nl; path=\/;.*; secure$/);
  });

  it("read the locale only under the name of the origin", () => {
    expect(localeFromCookies("__Host-EDULIMS_LOCALE=nl", true)).toBe("nl");
    expect(localeFromCookies("EDULIMS_LOCALE=nl", true)).toBeUndefined();
    expect(localeFromCookies("EDULIMS_LOCALE=nl", false)).toBe("nl");
    expect(localeFromCookies("__Host-EDULIMS_LOCALE=nl", false)).toBeUndefined();
    expect(localeFromCookies("EDULIMS_LOCALE=de", false)).toBeUndefined();
  });
});
