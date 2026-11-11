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

/** The core User schema URN that may prefix an attribute name or PATCH path (RFC 7644 §3.10). */
const CORE_USER_URN = "urn:ietf:params:scim:schemas:core:2.0:user:";

/** Returns an attribute name or PATCH path without the core User URN prefix, trimmed. */
export function stripCoreUserUrn(path: string): string {
  const trimmed = path.trim();
  return trimmed.toLowerCase().startsWith(CORE_USER_URN)
    ? trimmed.slice(CORE_USER_URN.length).trim()
    : trimmed;
}

/** Returns the value of `key` on `value`, also when it is written with the core User URN. */
function attribute(value: object, key: string): unknown[] {
  return Object.entries(value)
    .filter(([name]) => stripCoreUserUrn(name).toLowerCase() === key.toLowerCase())
    .map(([, entry]) => entry);
}

function addresses(value: unknown): string[] {
  if (typeof value === "string") return value.includes("@") ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(addresses);
  if (typeof value === "object" && value !== null) {
    return ["value", "userName", "emails"].flatMap((key) =>
      attribute(value, key).flatMap(addresses),
    );
  }
  return [];
}

/**
 * Returns the e-mail addresses a SCIM User create, replace or patch body would set: `userName`
 * when it is an address, every `emails` value, and the values of PATCH operations on those.
 */
export function scimBodyAddresses(body: unknown): string[] {
  const found =
    typeof body === "object" && body !== null
      ? ["userName", "emails"].flatMap((key) => attribute(body, key).flatMap(addresses))
      : [];
  const operations = field(body, "Operations");
  if (Array.isArray(operations)) {
    for (const operation of operations) {
      const path = field(operation, "path");
      const value = field(operation, "value");
      if (path === undefined) found.push(...addresses(value));
      else if (typeof path === "string" && /^(userName|emails)\b/i.test(stripCoreUserUrn(path))) {
        found.push(...addresses(value));
      }
    }
  }
  return [...new Set(found.map((address) => address.trim().toLowerCase()))];
}

/**
 * Returns whether any of `addresses` lies outside the provider's e-mail domains (owner decision
 * on #45). A provider with no domains configured is unrestricted, and its page warns about it.
 */
export async function addressOutsideDomains(
  db: Kysely<DB>,
  providerId: string,
  addresses: readonly string[],
): Promise<boolean> {
  if (addresses.length === 0) return false;
  const rows = await db
    .selectFrom("identity_provider_domain")
    .select("domain")
    .where("provider_id", "=", providerId)
    .execute();
  if (rows.length === 0) return false;
  const domains = new Set(rows.map((row) => row.domain));
  return addresses.some((address) => !domains.has(address.slice(address.lastIndexOf("@") + 1)));
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
