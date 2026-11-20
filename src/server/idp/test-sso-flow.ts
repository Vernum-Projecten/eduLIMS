// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Test support: one SSO sign-in through eduLIMS's own better-auth handler, from `/sign-in/sso`
// to the OIDC callback or the SAML ACS, against a stubbed identity provider (test-oidc.ts,
// test-saml-idp.ts). Returns where the browser lands and whether a session cookie was set.
import { z } from "zod";
import type { Auth } from "../auth.ts";
import type { StubIdp } from "./test-oidc.ts";
import { authnRequestIdOf, type StubSamlIdp, type StubSamlSubject } from "./test-saml-idp.ts";

/** Where a sign-in ended. */
export interface SsoOutcome {
  /** The path eduLIMS sent the browser to. */
  path: string;
  /** The `error` search parameter of that redirect, or `null`. */
  error: string | null;
  /** Whether the response set a session cookie. */
  signedIn: boolean;
}

function cookiesOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}

function outcomeOf(base: string, response: Response): SsoOutcome {
  const location = new URL(response.headers.get("location") ?? "/", base);
  return {
    path: location.pathname,
    error: location.searchParams.get("error"),
    signedIn: response.headers.getSetCookie().some((cookie) => /session_token=[^;]/.test(cookie)),
  };
}

async function start(auth: Auth, base: string, providerId: string) {
  const response = await auth.handler(
    new Request(`${base}/api/auth/sign-in/sso`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ providerId, callbackURL: "/", errorCallbackURL: "/login" }),
    }),
  );
  const { url } = z.object({ url: z.url() }).parse(await response.json());
  return { url, cookie: cookiesOf(response) };
}

/** Signs in through the OIDC provider `providerId`, whose stub issues an ID token with `claims`. */
export async function oidcSignIn(
  auth: Auth,
  base: string,
  providerId: string,
  idp: StubIdp,
  claims: Record<string, unknown>,
): Promise<SsoOutcome> {
  idp.claims = claims;
  const { url, cookie } = await start(auth, base, providerId);
  const state = new URL(url).searchParams.get("state") ?? "";
  const callback = await auth.handler(
    new Request(
      `${base}/api/auth/sso/callback/${providerId}?code=stub-code&state=${encodeURIComponent(state)}`,
      { headers: { cookie } },
    ),
  );
  return outcomeOf(base, callback);
}

/** Signs in through the SAML provider `providerId`, whose stub asserts `subject`. */
export async function samlSignIn(
  auth: Auth,
  base: string,
  providerId: string,
  idp: StubSamlIdp,
  subject: StubSamlSubject,
): Promise<SsoOutcome> {
  const { url, cookie } = await start(auth, base, providerId);
  const relayState = new URL(url).searchParams.get("RelayState") ?? "";
  const acsUrl = `${base}/api/auth/sso/saml2/sp/acs/${providerId}`;
  const spEntityId = `${base}/api/auth/sso/saml2/sp/metadata?providerId=${providerId}`;
  const response = idp.respond({
    authnRequestId: authnRequestIdOf(url),
    spEntityId,
    acsUrl,
    subject,
  });
  const acs = await auth.handler(
    new Request(acsUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie,
        origin: "https://idp.example.test",
      },
      body: new URLSearchParams({ SAMLResponse: response, RelayState: relayState }),
    }),
  );
  return outcomeOf(base, acs);
}
