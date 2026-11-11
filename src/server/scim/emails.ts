// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// One e-mail address, one owner (#45, H1; ASVS V6.8.1, API1): a SCIM create or change may not
// take an address of a user another sign-in method owns (an account at another provider, a
// user another provider provisioned, a local user). Refused before the plugin runs, with a
// generic 409 that names no user and no provider. That a directory learns an address is taken
// is accepted (ADR 0017): every SCIM client is a directory an administrator configured.
// Relative imports: `pnpm db:seed` loads auth.ts in plain Node.
import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import type { DB } from "../db/schema.gen.ts";

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function addresses(value: unknown): string[] {
  if (typeof value === "string") return value.includes("@") ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(addresses);
  if (typeof value === "object" && value !== null) {
    return [...addresses(field(value, "value")), ...addresses(field(value, "userName"))].concat(
      addresses(field(value, "emails")),
    );
  }
  return [];
}

/**
 * Returns the e-mail addresses a SCIM User create, replace or patch body would set: `userName`
 * when it is an address, every `emails` value, and the values of PATCH operations on those.
 */
export function scimBodyAddresses(body: unknown): string[] {
  const found = [...addresses(field(body, "userName")), ...addresses(field(body, "emails"))];
  const operations = field(body, "Operations");
  if (Array.isArray(operations)) {
    for (const operation of operations) {
      const path = field(operation, "path");
      const value = field(operation, "value");
      if (path === undefined) found.push(...addresses(value));
      else if (typeof path === "string" && /^(userName|emails)\b/i.test(path)) {
        found.push(...addresses(value));
      }
    }
  }
  return [...new Set(found.map((address) => address.trim().toLowerCase()))];
}

/**
 * Returns whether any of `addresses` belongs to a user that `providerId` does not own: a user
 * with no account at that provider and not provisioned by it. Such an address is taken.
 */
export async function addressTakenElsewhere(
  db: Kysely<DB>,
  providerId: string,
  addresses: readonly string[],
): Promise<boolean> {
  if (addresses.length === 0) return false;
  const row = await db
    .selectFrom("user")
    .select("user.id")
    .where("user.email", "in", [...addresses])
    .where((eb) =>
      eb.and([
        eb.or([eb("user.provisioned_by", "is", null), eb("user.provisioned_by", "<>", providerId)]),
        eb.not(
          eb.exists(
            eb
              .selectFrom("account")
              .select("account.id")
              .whereRef("account.userId", "=", "user.id")
              .where("account.providerId", "=", providerId),
          ),
        ),
      ]),
    )
    .executeTakeFirst();
  return row !== undefined;
}
