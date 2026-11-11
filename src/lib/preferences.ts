// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Reads the display preferences from their cookies on either side: the request's cookies during
// SSR, `document.cookie` in the browser. Both read the same cookie name (`__Host-` over https:
// the server knows it from BETTER_AUTH_URL, the browser from the page), so hydration matches.
import { createIsomorphicFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { hostCookieName, readCookie } from "@/lib/cookies";
import { columnsCookieName, parseHiddenColumns } from "@/lib/table-columns";
import {
  parseSidebarOpen,
  parseTheme,
  SIDEBAR_COOKIE,
  THEME_COOKIE,
  type Theme,
} from "@/lib/theme";
import { isSecureOrigin } from "@/server/cookie-security";

/** Reads preference cookie `base` from `document.cookie` in the browser. */
function clientPreference(base: string): string | undefined {
  return readCookie(document.cookie, hostCookieName(base, window.location.protocol === "https:"));
}

export const readThemePreference = createIsomorphicFn()
  .server((): Theme => parseTheme(getCookie(hostCookieName(THEME_COOKIE, isSecureOrigin()))))
  .client((): Theme => parseTheme(clientPreference(THEME_COOKIE)));

export const readSidebarOpen = createIsomorphicFn()
  .server((): boolean =>
    parseSidebarOpen(getCookie(hostCookieName(SIDEBAR_COOKIE, isSecureOrigin()))),
  )
  .client((): boolean => parseSidebarOpen(clientPreference(SIDEBAR_COOKIE)));

/** Reads the hidden column ids of data table `tableId` from its preference cookie (#58). */
export const readHiddenColumns = createIsomorphicFn()
  .server((tableId: string): string[] =>
    parseHiddenColumns(getCookie(hostCookieName(columnsCookieName(tableId), isSecureOrigin()))),
  )
  .client((tableId: string): string[] =>
    parseHiddenColumns(clientPreference(columnsCookieName(tableId))),
  );
