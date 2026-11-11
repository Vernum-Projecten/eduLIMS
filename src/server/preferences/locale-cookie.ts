// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Applies a user's saved language when they sign in, so the first page after sign-in already
// renders in it (ADR 0011). Relative imports: `pnpm db:seed` loads auth.ts in plain Node.
import "@tanstack/react-start/server-only";
import { createAuthMiddleware } from "better-auth/api";
import { isLocale, type Locale } from "../../i18n/runtime.js";
import { hostCookieName } from "../../lib/cookies.ts";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from "../../lib/i18n/locale-cookie.ts";

/** Returns `value` when it is one of the Paraglide locales, else `undefined`. */
export function savedLocale(value: unknown): Locale | undefined {
  return isLocale(value) ? value : undefined;
}

/**
 * Returns a better-auth `hooks.after` middleware that sets the locale cookie from
 * the signed-in user's saved locale. It runs on every endpoint that creates a session (email
 * sign-in and the OAuth callbacks of Entra ID and Keycloak) and does nothing otherwise.
 *
 * The cookie carries the same name and attributes as the one the language menu writes in the
 * browser (`__Host-` and `Secure` over https), without `HttpOnly`, so the menu can overwrite it.
 */
export function applySavedLocaleOnSignIn(baseURL: string) {
  const secure = new URL(baseURL).protocol === "https:";
  return createAuthMiddleware(async (ctx) => {
    const locale = savedLocale(ctx.context.newSession?.user["locale"]);
    if (!locale) return;
    ctx.setCookie(hostCookieName(LOCALE_COOKIE, secure), locale, {
      path: "/",
      maxAge: LOCALE_COOKIE_MAX_AGE,
      sameSite: "lax",
      secure,
      httpOnly: false,
    });
  });
}
