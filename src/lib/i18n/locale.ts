// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The active locale. The server resolves it per request in `src/server-entry.ts`; the
// browser reads the one the server rendered, so hydration never switches language.
import {
  defineCustomClientStrategy,
  extractLocaleFromCookie,
  getLocale,
  type Locale,
  locales,
  setLocale,
  toLocale,
} from "@/i18n/runtime";

export { getLocale, type Locale, locales };

/**
 * Reads the locale the server rendered into `<html lang>`, or `undefined` outside a browser.
 *
 * NOTE: no requirement governs this: our own design (ADR 0011). Accept-Language and
 * `navigator.languages` can disagree, so the client trusts the server's choice instead.
 */
export function documentLocale(): Locale | undefined {
  if (typeof document === "undefined") return undefined;
  return toLocale(document.documentElement.lang);
}

defineCustomClientStrategy("custom-documentLang", {
  getLocale: documentLocale,
  // The cookie strategy persists the choice; the next document renders with the new lang.
  setLocale: () => undefined,
});

/** Returns the name of `locale` in that language itself ("English", "Nederlands"). */
export function localeName(locale: Locale): string {
  return new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale;
}

/**
 * Tells whether the locale cookie names another language than the document was rendered in,
 * as after a sign-in that applied the user's saved language. The caller then reloads so the
 * server renders the whole page in that language.
 */
export function cookieLocaleDiffersFromDocument(): boolean {
  const cookieLocale = extractLocaleFromCookie();
  return cookieLocale !== undefined && cookieLocale !== documentLocale();
}

/** Stores `locale` in the locale cookie and reloads the page so the server renders it. */
export function switchLocale(locale: Locale): void {
  void setLocale(locale);
}
