// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Reads the display preferences from their cookies on either side: the request's cookies during
// SSR, `document.cookie` in the browser. Both read the same cookie, so hydration matches.
import { createIsomorphicFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { readCookie } from "@/lib/cookies";
import {
  parseSidebarOpen,
  parseTheme,
  SIDEBAR_COOKIE,
  THEME_COOKIE,
  type Theme,
} from "@/lib/theme";

export const readThemePreference = createIsomorphicFn()
  .server((): Theme => parseTheme(getCookie(THEME_COOKIE)))
  .client((): Theme => parseTheme(readCookie(document.cookie, THEME_COOKIE)));

export const readSidebarOpen = createIsomorphicFn()
  .server((): boolean => parseSidebarOpen(getCookie(SIDEBAR_COOKIE)))
  .client((): boolean => parseSidebarOpen(readCookie(document.cookie, SIDEBAR_COOKIE)));
