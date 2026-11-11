// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

/** The browser and operating system a session's user agent names, or `null` for unknown. */
export interface DeviceSummary {
  browser: string | null;
  os: string | null;
}

// Order matters: Edge and Opera also say Chrome, Chrome also says Safari.
const BROWSERS = [
  ["Edge", /\bEdg(e|A|iOS)?\//],
  ["Opera", /\bOPR\//],
  ["Firefox", /\b(Firefox|FxiOS)\//],
  ["Chrome", /\b(Chrome|CriOS)\//],
  ["Safari", /\bSafari\//],
] as const;

const SYSTEMS = [
  ["iOS", /\b(iPhone|iPad|iPod)\b/],
  ["Android", /\bAndroid\b/],
  ["Windows", /\bWindows\b/],
  ["macOS", /\bMac OS X\b|\bMacintosh\b/],
  ["ChromeOS", /\bCrOS\b/],
  ["Linux", /\bLinux\b/],
] as const;

/**
 * Summarises a user agent string as a browser and an operating system name, for the sessions
 * list of the user detail sheet. It never returns the raw string, which can carry more detail
 * than the screen needs.
 */
export function summariseUserAgent(userAgent: string | null | undefined): DeviceSummary {
  if (!userAgent) return { browser: null, os: null };
  const browser = BROWSERS.find(([, pattern]) => pattern.test(userAgent))?.[0] ?? null;
  const os = SYSTEMS.find(([, pattern]) => pattern.test(userAgent))?.[0] ?? null;
  return { browser, os };
}
