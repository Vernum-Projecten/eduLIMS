// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import type { Locale } from "../../i18n/runtime.js";
import type { SessionUser } from "../authz.ts";
import type { DB } from "../db/schema.gen.ts";
import { AuthError } from "../middleware.ts";
import { savePreferredLocaleInput } from "./schemas.ts";

/**
 * Saves the interface language of the signed-in user and returns it.
 *
 * The update filters on the session user's id, so a user can only change their own row.
 *
 * @throws {AuthError} 401 when there is no session user.
 * @throws {z.ZodError} when `input` is not `{ locale }` with a Paraglide locale.
 */
export async function storePreferredLocale(
  db: Kysely<DB>,
  user: Pick<SessionUser, "id"> | null,
  input: unknown,
): Promise<Locale> {
  if (!user) throw new AuthError(401);
  const { locale } = savePreferredLocaleInput.parse(input);
  await db
    .updateTable("user")
    .set({ locale, updatedAt: new Date() })
    .where("id", "=", user.id)
    .execute();
  return locale;
}
