// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The colour theme preference. The server reads the cookie and renders `<html class>` from it,
// so a page never flashes in the wrong theme; "system" leaves the class off and the CSS follows
// `prefers-color-scheme` (src/styles/app.css).

export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

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
  const attributes = ["path=/", `max-age=${THEME_COOKIE_MAX_AGE}`, "samesite=lax"];
  if (secure) attributes.push("secure");
  return `${THEME_COOKIE}=${theme}; ${attributes.join("; ")}`;
}

/** The shadcn sidebar's cookie name (`SIDEBAR_COOKIE_NAME` in src/components/ui/sidebar.tsx). */
export const SIDEBAR_COOKIE = "sidebar_state";

/** Whether the sidebar starts expanded: open unless the cookie says "false". */
export function parseSidebarOpen(value: string | undefined): boolean {
  return value !== "false";
}
