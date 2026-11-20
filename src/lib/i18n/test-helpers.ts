// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Shared set-up of the label tests: messages in a chosen language, as a request would read them.
// Test support only.
import { paraglideMiddleware } from "@/i18n/server";
import { defineLocaleCookieServerStrategy } from "./locale-cookie";

// The server entry registers the locale cookie strategy; plain http, as in development.
defineLocaleCookieServerStrategy(() => false);

/** Runs `fn` inside a request whose locale cookie is `locale`, as the server entry does. */
export async function inLocale<T>(locale: "en" | "nl", fn: () => T): Promise<T> {
  let result: T | undefined;
  await paraglideMiddleware(
    new Request("http://localhost/", { headers: { cookie: `EDULIMS_LOCALE=${locale}` } }),
    () => {
      result = fn();
      return new Response(null);
    },
  );
  if (result === undefined) throw new Error("the middleware did not run the callback");
  return result;
}
