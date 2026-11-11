// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Server functions callable from loaders/beforeLoad on both sides; bodies run on the server.
import { createServerFn } from "@tanstack/react-start";
import { getCookie, getRequestHeaders } from "@tanstack/react-start/server";
import { hostCookieName } from "@/lib/cookies";
import { LAST_SIGN_IN_METHOD_COOKIE, offeredSignInMethod } from "@/lib/sign-in-method";
import { identityProviders } from "@/server/auth";
import { isSecureOrigin } from "@/server/cookie-security";
import { demoAccountsFor } from "@/server/demo-accounts";
import { getEnv } from "@/server/env";
import { getSessionUser } from "@/server/session";

/** The signed-in user (id, name, email, roles) or `null`. */
export const getSession = createServerFn({ method: "GET" }).handler(() =>
  getSessionUser(getRequestHeaders()),
);

/**
 * Which sign-in methods the login page may offer, and the public demo accounts while the
 * development login is enabled (`null` otherwise).
 */
export const getLoginOptions = createServerFn({ method: "GET" }).handler(() => {
  const env = getEnv();
  const providers = identityProviders(env);
  return {
    providers,
    devLogin: env.EDULIMS_DEV_LOGIN,
    demoAccounts: demoAccountsFor(env.EDULIMS_DEV_LOGIN, providers),
    lastSignInMethod: offeredSignInMethod(
      getCookie(hostCookieName(LAST_SIGN_IN_METHOD_COOKIE, isSecureOrigin())),
      providers.map((provider) => provider.id),
      env.EDULIMS_DEV_LOGIN,
    ),
  };
});
