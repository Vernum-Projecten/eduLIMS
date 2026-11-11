// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The locale cookie as a custom Paraglide strategy: Paraglide's built-in "cookie" strategy has
// one compiled name, and the name here depends on the origin (`__Host-` over https, #43).
// Relative imports: the sign-in hook loads this file in plain Node through `pnpm db:seed`.
import { defineCustomServerStrategy, type Locale, toLocale } from "../../i18n/runtime.js";
import { hostCookieName, preferenceCookie, readCookie } from "../cookies.ts";

/** The locale cookie's base name; over https it carries the `__Host-` prefix. */
export const LOCALE_COOKIE = "EDULIMS_LOCALE";

/** 400 days in seconds, the longest lifetime browsers keep a cookie (Paraglide's default). */
export const LOCALE_COOKIE_MAX_AGE = 34_560_000;

/** The strategy name in `project.inlang/paraglide.config.ts`. */
export const LOCALE_COOKIE_STRATEGY = "custom-localeCookie";

/** Returns the locale a `Cookie` header or `document.cookie` string names, if any. */
export function localeFromCookies(
  cookies: string | null | undefined,
  secure: boolean,
): Locale | undefined {
  return toLocale(readCookie(cookies, hostCookieName(LOCALE_COOKIE, secure)));
}

/** Returns the `document.cookie` assignment that stores `locale` for the whole site. */
export function localeCookie(locale: Locale, secure: boolean): string {
  return preferenceCookie(LOCALE_COOKIE, locale, LOCALE_COOKIE_MAX_AGE, secure);
}

/**
 * Registers the server side of the strategy: the request's locale cookie, under the name
 * `isSecure()` selects. The server entry passes the origin check; tests pass a constant.
 */
export function defineLocaleCookieServerStrategy(isSecure: () => boolean): void {
  defineCustomServerStrategy(LOCALE_COOKIE_STRATEGY, {
    getLocale: (request) => localeFromCookies(request?.headers.get("cookie"), isSecure()),
  });
}
