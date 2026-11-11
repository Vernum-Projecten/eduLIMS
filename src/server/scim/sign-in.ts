// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The sso plugin's `resolveUser` for SCIM-provisioned users (#45, ADR 0017): an SSO sign-in
// becomes the user the directory provisioned when the sign-in's directory id (a configured
// claim, else the account key) is the SCIM `externalId` of an active SCIM User of that same
// provider. Never by email. Relative imports: `pnpm db:seed` loads auth.ts in plain Node.
import "@tanstack/react-start/server-only";
import { defineRequestState, hasRequestState } from "@better-auth/core/context";
import { acquireActiveSCIMUserLink } from "@better-auth/scim";
import type { SSOOptions } from "@better-auth/sso";
import type { DBTransactionAdapter } from "better-auth";
import type { Kysely } from "kysely";
import { ACCOUNT_DEPROVISIONED_ERROR } from "../../lib/identity-providers.ts";
import type { DB } from "../db/schema.gen.ts";
import { providerSettings } from "../idp/registry.ts";
import { readClaim } from "../idp-roles.ts";

type ResolveUser = NonNullable<SSOOptions["resolveUser"]>;
type ResolutionInput = Parameters<ResolveUser>[0];

function firstText(value: unknown): string | null {
  if (typeof value === "string" && value !== "") return value;
  if (Array.isArray(value)) return firstText(value[0]);
  return null;
}

/**
 * Returns the directory id of a sign-in: the account key (`sub`, the NameID) when `claim` is
 * `null`, else an ID-token claim by dot path (OIDC) or an assertion attribute by its exact name
 * (SAML, whose names contain dots). `null` when the sign-in does not carry it.
 */
export function directoryIdOf(input: ResolutionInput, claim: string | null): string | null {
  if (claim === null) return input.accountKey.accountId;
  if (input.protocol === "saml") return firstText(input.providerAttributes[claim]);
  return firstText(readClaim(input.verifiedIdTokenClaims, claim));
}

/** Returns whether the directory deactivated or deleted the SCIM User with this `externalId`. */
async function wasDeprovisioned(
  database: DBTransactionAdapter,
  connectionId: string,
  externalId: string,
): Promise<boolean> {
  const where = [
    { field: "connectionId", value: connectionId },
    { field: "externalId", value: externalId },
  ];
  const inactive = await database.findOne({
    model: "scimUser",
    where: [...where, { field: "active", value: false }],
  });
  if (inactive) return true;
  const deleted = await database.findOne({ model: "scimIdentityTombstone", where });
  return deleted !== null;
}

/** The directory id of the sign-in this request runs, for the account write that follows. */
interface SignInDirectoryId {
  providerId: string;
  directoryId: string;
}

const signInDirectoryId = defineRequestState<SignInDirectoryId | null>(() => null);

/**
 * Returns `data` with the directory id of this request's sign-in added (`directoryId`), when the
 * account written is that sign-in's account at that provider (#45, M1): SCIM then links the user
 * on it instead of creating a second one. Other writes are returned as they are.
 */
export async function withDirectoryId<T extends Record<string, unknown>>(data: T): Promise<T> {
  if (!(await hasRequestState())) return data;
  const current = await signInDirectoryId.get();
  if (!current || data["providerId"] !== current.providerId) return data;
  return { ...data, directoryId: current.directoryId };
}

/**
 * Returns the sso plugin's `resolveUser`: `link` to the provisioned user, `reject` with
 * `account_deprovisioned` for one the directory deactivated or deleted, else `continue` (a user
 * the directory does not manage signs in as before).
 */
export function scimSignInResolver(db: Kysely<DB>): ResolveUser {
  return async (input, { database }) => {
    const settings = await providerSettings(db, input.providerId);
    if (!settings) return { action: "continue" };
    const externalId = directoryIdOf(input, settings.scimExternalIdClaim);
    if (!externalId) return { action: "continue" };
    if (await hasRequestState()) {
      await signInDirectoryId.set({ providerId: input.providerId, directoryId: externalId });
    }
    const link = await acquireActiveSCIMUserLink(
      { connectionId: input.providerId, externalId },
      { database },
    );
    if (link) return { action: "link", userId: link.userId, profile: "preserve" };
    if (await wasDeprovisioned(database, input.providerId, externalId)) {
      return { action: "reject", code: ACCOUNT_DEPROVISIONED_ERROR };
    }
    return { action: "continue" };
  };
}
