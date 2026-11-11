// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Applies a user's saved language when they sign in, so the first page after sign-in already
// renders in it (ADR 0011). Relative imports: `pnpm db:seed` loads auth.ts in plain Node.
import "@tanstack/react-start/server-only";
import { createAuthMiddleware } from "better-auth/api";
import { cookieMaxAge, cookieName, isLocale, type Locale } from "../../i18n/runtime.js";

/** Returns `value` when it is one of the Paraglide locales, else `undefined`. */
export function savedLocale(value: unknown): Locale | undefined {
  return isLocale(value) ? value : undefined;
}

/**
 * Returns a better-auth `hooks.after` middleware that sets the `EDULIMS_LOCALE` cookie from
 * the signed-in user's saved locale. It runs on every endpoint that creates a session (email
 * sign-in and the OAuth callbacks of Entra ID and Keycloak) and does nothing otherwise.
 *
 * The cookie carries the same attributes as the one Paraglide's `setLocale` writes in the
 * browser, without `HttpOnly`, so the language menu can overwrite it later.
 */
export function applySavedLocaleOnSignIn(baseURL: string) {
  const secure = new URL(baseURL).protocol === "https:";
  return createAuthMiddleware(async (ctx) => {
    const locale = savedLocale(ctx.context.newSession?.user["locale"]);
    if (!locale) return;
    ctx.setCookie(cookieName, locale, {
      path: "/",
      maxAge: cookieMaxAge,
      sameSite: "lax",
      secure,
      httpOnly: false,
    });
  });
}
