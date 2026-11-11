// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { createContext, type ReactNode, useContext, useMemo, useState } from "react";
import { readThemePreference } from "@/lib/preferences";
import { type Theme, themeCookie } from "@/lib/theme";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Holds the theme preference. The first value comes from the cookie on both sides (so the
 * server renders the right `<html class>`); a change updates the state and the cookie at once.
 */
export function useThemeState(): ThemeContextValue {
  const [theme, setThemeState] = useState<Theme>(() => readThemePreference());
  return useMemo(
    () => ({
      theme,
      setTheme: (next: Theme) => {
        // biome-ignore lint/suspicious/noDocumentCookie: the server reads it on the next request; the Cookie Store API is not in every supported browser
        document.cookie = themeCookie(next, window.location.protocol === "https:");
        setThemeState(next);
      },
    }),
    [theme],
  );
}

export function ThemeProvider({
  value,
  children,
}: Readonly<{ value: ThemeContextValue; children: ReactNode }>) {
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Returns the active theme preference and its setter. */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within a ThemeProvider.");
  return context;
}
