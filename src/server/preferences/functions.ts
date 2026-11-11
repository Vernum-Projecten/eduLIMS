// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Server functions for the signed-in user's own preferences; bodies run on the server.
import { createServerFn } from "@tanstack/react-start";
import { getDb } from "../db/index.ts";
import { authMiddleware } from "../middleware.ts";
import { storeLastPortal, storePreferredLocale } from "./queries.ts";
import { saveLastPortalInput, savePreferredLocaleInput } from "./schemas.ts";

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

/**
 * Saves the portal the signed-in user picked in the portal switcher (ADR 0012); `/` and the
 * next sign-in land there. Refuses anonymous calls with 401, a portal of a role the session
 * does not hold with 403, and any other value through the Zod schema.
 */
export const saveLastPortal = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(saveLastPortalInput)
  .handler(async ({ data, context }) => ({
    portal: await storeLastPortal(getDb(), context.user, data),
  }));
