// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// better-auth's origin check over HTTP against the built server (ASVS V3.5.1, #371): a
// cookie-bearing POST to `/api/auth/*` from another origin is refused with 403 and changes
// nothing, and the same request from the app's own origin goes through. The e2e build runs with
// NODE_ENV=test, where better-auth would skip the check unless `createAuth` keeps it on.
import { expect, test } from "@playwright/test";
import { copyAccount } from "./accounts";
import { DEV_PASSWORD, withAppOrigin } from "./fixtures";
import { appUrl } from "./run-env";

test("a cookie-bearing sign-out from another origin answers 403 and keeps the session (V3.5.1)", async ({
  playwright,
}) => {
  const account = await copyAccount("student@example.test", "origin-check");
  const browser = await playwright.request.newContext({ baseURL: appUrl() });
  try {
    const signIn = await browser.post(`${appUrl()}/api/auth/sign-in/email`, {
      data: { email: account.email, password: DEV_PASSWORD },
    });
    expect(signIn.status()).toBe(200);

    const forged = await browser.post(`${appUrl()}/api/auth/sign-out`, {
      headers: { origin: "https://evil.example" },
      data: {},
    });
    expect(forged.status()).toBe(403);
    const kept = await browser.get(`${appUrl()}/api/auth/get-session`);
    expect(await kept.json()).toMatchObject({ user: { id: account.id } });

    const noOrigin = await browser.post(`${appUrl()}/api/auth/sign-out`, { data: {} });
    expect(noOrigin.status()).toBe(403);
  } finally {
    await browser.dispose();
  }
});

test("a cookie-bearing sign-out from the app's own origin signs out (V3.5.1)", async ({
  playwright,
}) => {
  const account = await copyAccount("student@example.test", "origin-own");
  const browser = await playwright.request.newContext({ baseURL: appUrl() });
  try {
    const signIn = await browser.post(`${appUrl()}/api/auth/sign-in/email`, {
      data: { email: account.email, password: DEV_PASSWORD },
    });
    expect(signIn.status()).toBe(200);

    const own = await browser.post(`${appUrl()}/api/auth/sign-out`, {
      headers: withAppOrigin(),
      data: {},
    });
    expect(own.status()).toBe(200);
    const after = await browser.get(`${appUrl()}/api/auth/get-session`);
    expect(await after.json()).toBeNull();
  } finally {
    await browser.dispose();
  }
});
