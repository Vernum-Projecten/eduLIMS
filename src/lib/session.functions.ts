// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Server functions callable from loaders/beforeLoad on both sides; bodies run on the server.
import { createServerFn } from "@tanstack/react-start";
import { getCookie, getRequestHeaders } from "@tanstack/react-start/server";
import { getLocale } from "@/i18n/runtime";
import { hostCookieName } from "@/lib/cookies";
import { LAST_SIGN_IN_METHOD_COOKIE, offeredSignInMethod } from "@/lib/sign-in-method";
import { isSecureOrigin } from "@/server/cookie-security";
import { getDb } from "@/server/db/index";
import { demoAccountsFor } from "@/server/demo-accounts";
import { getEnv } from "@/server/env";
import { enabledProviders, hasDomainRouting, providerForEmail } from "@/server/idp/registry";
import { institutionEmailInput } from "@/server/idp/schemas";
import { getSessionUser } from "@/server/session";

/** The signed-in user (id, name, email, roles) or `null`. */
export const getSession = createServerFn({ method: "GET" }).handler(() =>
  getSessionUser(getRequestHeaders()),
);

/**
 * Which sign-in methods the login page may offer: one button per enabled identity provider
 * (label and icon, never its configuration), the institution-email field when any provider has
 * domains, and the public demo accounts while the development login is enabled.
 */
export const getLoginOptions = createServerFn({ method: "GET" }).handler(async () => {
  const env = getEnv();
  const db = getDb();
  const providers = await enabledProviders(db, getLocale() === "nl" ? "nl" : "en");
  return {
    providers,
    emailRouting: await hasDomainRouting(db),
    devLogin: env.EDULIMS_DEV_LOGIN,
    demoAccounts: demoAccountsFor(env.EDULIMS_DEV_LOGIN, providers),
    lastSignInMethod: offeredSignInMethod(
      getCookie(hostCookieName(LAST_SIGN_IN_METHOD_COOKIE, isSecureOrigin())),
      providers.map((provider) => provider.id),
      env.EDULIMS_DEV_LOGIN,
    ),
  };
});

/**
 * Returns the enabled provider an institution email routes to, or `null`. An unknown domain
 * gets the same `null` as a missing one, so the domains of other institutions stay hidden.
 */
export const routeInstitutionEmail = createServerFn({ method: "POST" })
  .validator(institutionEmailInput)
  .handler(async ({ data }) => ({ providerId: await providerForEmail(getDb(), data.email) }));
