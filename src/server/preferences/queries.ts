// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import type { Locale } from "../../i18n/runtime.js";
import type { Role } from "../../lib/roles.ts";
import { hasRole, type SessionUser } from "../authz.ts";
import type { DB } from "../db/schema.gen.ts";
import { AuthError } from "../middleware.ts";
import { saveLastPortalInput, savePreferredLocaleInput } from "./schemas.ts";

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

/**
 * Saves the portal the signed-in user switched to, so `/` and the next sign-in land there
 * (ADR 0012), and returns it. Only a portal of a role the session holds is saved; the update
 * filters on the session user's id.
 *
 * @throws {AuthError} 401 without a session user, 403 for a portal of a role the user lacks.
 * @throws {z.ZodError} when `input` is not `{ portal }` with a portal name.
 */
export async function storeLastPortal(
  db: Kysely<DB>,
  user: Pick<SessionUser, "id" | "roles"> | null,
  input: unknown,
): Promise<Role> {
  if (!user) throw new AuthError(401);
  const { portal } = saveLastPortalInput.parse(input);
  if (!hasRole(user, portal)) throw new AuthError(403);
  await db
    .updateTable("user")
    .set({ last_portal: portal, updatedAt: new Date() })
    .where("id", "=", user.id)
    .execute();
  return portal;
}
