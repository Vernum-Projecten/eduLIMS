// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Server functions for the signed-in user's own preferences; bodies run on the server.
import { createServerFn } from "@tanstack/react-start";
import { getDb } from "../db/index.ts";
import { authMiddleware } from "../middleware.ts";
import { storePreferredLocale } from "./queries.ts";
import { savePreferredLocaleInput } from "./schemas.ts";

/**
 * Saves the language the signed-in user picked in the language menu (ADR 0011). The next
 * sign-in on any device sets the locale cookie from it. Refuses anonymous calls with 401 and
 * any value that is not a Paraglide locale.
 */
export const savePreferredLocale = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(savePreferredLocaleInput)
  .handler(async ({ data, context }) => ({
    locale: await storePreferredLocale(getDb(), context.user, data),
  }));
