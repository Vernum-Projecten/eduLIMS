// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// What eduLIMS keeps of an identity provider's tokens (#46, ADR 0015): nothing but the ID token,
// sealed. eduLIMS never calls the provider after sign-in, so the access and refresh tokens are
// dropped before better-auth writes an account (the `databaseHooks.account` below); the ID token
// stays only as the `id_token_hint` of RP-initiated logout, AES-256-GCM under `EDULIMS_DATA_KEY`
// and bound to its account row. The encrypting adapter seals it, because only the adapter knows
// the row's id (better-auth's `encryptOAuthTokens` does not reach the sso plugin's accounts).
// Relative imports: `pnpm db:seed` loads auth.ts in plain Node.
import "@tanstack/react-start/server-only";
import type { BetterAuthOptions } from "better-auth";
import { logSecurityEvent } from "../security-log.ts";
import { DataKeyError, decryptSecret, encryptSecret, isEnvelope, type Keyring } from "./crypto.ts";

/** The additional authenticated data of a sealed ID token: the account row it belongs to. */
export function idTokenAad(accountId: string): string {
  return `edulims:account:${accountId}:idToken`;
}

type AccountHooks = NonNullable<NonNullable<BetterAuthOptions["databaseHooks"]>["account"]>;

/** Returns an account write with no access or refresh token. */
export function withoutAccessTokens<T extends Record<string, unknown>>(data: T): T {
  const copy: Record<string, unknown> = { ...data };
  if ("accessToken" in copy) copy["accessToken"] = null;
  if ("refreshToken" in copy) copy["refreshToken"] = null;
  // The copy has the write's own keys; only token values changed.
  return copy as T;
}

/**
 * Returns an account write with no access or refresh token and the ID token sealed for the row
 * `accountId`. Without a row id or a data key (a development machine) the ID token is not kept:
 * sign-out then ends the eduLIMS session only.
 */
export function sealAccountWrite<T extends Record<string, unknown>>(
  keyring: Keyring,
  accountId: unknown,
  data: T,
): T {
  const copy: Record<string, unknown> = withoutAccessTokens(data);
  const idToken = copy["idToken"];
  if (typeof idToken === "string" && idToken !== "" && !isEnvelope(idToken)) {
    copy["idToken"] =
      typeof accountId === "string" && keyring.current
        ? encryptSecret(keyring, idTokenAad(accountId), idToken)
        : null;
  }
  return copy as T;
}

/** Returns the stored ID token in the clear, or `null` when there is none or it does not open. */
export function openIdToken(
  keyring: Keyring,
  accountId: string,
  stored: string | null,
): string | null {
  if (!stored || !isEnvelope(stored)) return null;
  try {
    return decryptSecret(keyring, idTokenAad(accountId), stored);
  } catch (error) {
    if (error instanceof DataKeyError) {
      // NOTE: no requirement governs this: our own design; without the hint sign-out still ends
      // the eduLIMS session, and the IdP asks the user to confirm its own logout.
      logSecurityEvent("error", "crypt_decrypt_fail", {
        outcome: "failure",
        kind: error.kind,
        target_type: "account",
        target_id: accountId,
        reason: "id_token",
      });
      return null;
    }
    throw error;
  }
}

/**
 * Re-encrypts a stored ID token under the current key (`idp rekey`).
 *
 * @throws DataKeyError when neither key opens it.
 */
export function resealIdToken(keyring: Keyring, accountId: string, stored: string): string {
  const aad = idTokenAad(accountId);
  return encryptSecret(keyring, aad, decryptSecret(keyring, aad, stored));
}

/** The better-auth `databaseHooks.account` that keep no access or refresh token. */
export const accountTokenHooks: AccountHooks = {
  create: { before: async (account) => ({ data: withoutAccessTokens(account) }) },
  update: { before: async (account) => ({ data: withoutAccessTokens(account) }) },
};
