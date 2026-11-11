// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The colour theme and sidebar preferences. The server reads their cookies and renders
// `<html class>` and the sidebar from them, so a page never flashes in the wrong state;
// "system" leaves the class off and the CSS follows `prefers-color-scheme` (src/styles/app.css).
import { preferenceCookie } from "./cookies.ts";

export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

/** The theme cookie's base name; over https it carries the `__Host-` prefix (`hostCookieName`). */
export const THEME_COOKIE = "EDULIMS_THEME";
/** One year, in seconds. */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Returns `value` when it names a theme, else "system". */
export function parseTheme(value: unknown): Theme {
  return THEMES.find((theme) => theme === value) ?? "system";
}

/** The class `<html>` carries for `theme`: "light" or "dark", none for "system". */
export function themeClass(theme: Theme): "light" | "dark" | undefined {
  return theme === "system" ? undefined : theme;
}

/** The `document.cookie` assignment that stores `theme` for the whole site. */
export function themeCookie(theme: Theme, secure: boolean): string {
  return preferenceCookie(THEME_COOKIE, theme, THEME_COOKIE_MAX_AGE, secure);
}

/**
 * The sidebar cookie's base name. eduLIMS writes it itself (`sidebarCookie`), because the
 * shadcn sidebar's own `sidebar_state` cookie cannot carry the `__Host-` prefix.
 */
export const SIDEBAR_COOKIE = "EDULIMS_SIDEBAR";
/** One week, in seconds, as the shadcn sidebar keeps its state. */
export const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

/** Whether the sidebar starts expanded: open unless the cookie says "false". */
export function parseSidebarOpen(value: string | undefined): boolean {
  return value !== "false";
}

/** The `document.cookie` assignment that stores whether the sidebar is open. */
export function sidebarCookie(open: boolean, secure: boolean): string {
  return preferenceCookie(SIDEBAR_COOKIE, String(open), SIDEBAR_COOKIE_MAX_AGE, secure);
}
