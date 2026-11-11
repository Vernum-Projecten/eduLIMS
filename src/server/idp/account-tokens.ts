// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// What eduLIMS keeps of an identity provider's tokens (#46, ADR 0015): nothing but the ID token,
// sealed. eduLIMS never calls the provider after sign-in, so the access and refresh tokens are
// dropped before better-auth writes an account; the ID token stays only as the `id_token_hint`
// of RP-initiated logout, AES-256-GCM under `EDULIMS_DATA_KEY` (better-auth's
// `encryptOAuthTokens` does not reach the sso plugin's accounts).
// Relative imports: `pnpm db:seed` loads auth.ts in plain Node.
import "@tanstack/react-start/server-only";
import type { BetterAuthOptions } from "better-auth";
import { DataKeyError, decryptSecret, encryptSecret, isEnvelope, type Keyring } from "./crypto.ts";

/** The additional authenticated data of a sealed ID token: the field it belongs to. */
const ID_TOKEN_AAD = "edulims:account:idToken";

type AccountHooks = NonNullable<NonNullable<BetterAuthOptions["databaseHooks"]>["account"]>;

/** Returns the account write with no access or refresh token and the ID token sealed. */
export function withoutPlainTokens<T extends Record<string, unknown>>(
  keyring: Keyring,
  data: T,
): T {
  const copy: Record<string, unknown> = { ...data };
  if ("accessToken" in copy) copy["accessToken"] = null;
  if ("refreshToken" in copy) copy["refreshToken"] = null;
  const idToken = copy["idToken"];
  if (typeof idToken === "string" && idToken !== "" && !isEnvelope(idToken)) {
    // Without a data key (a development machine), the token is not kept: sign-out then ends
    // the eduLIMS session only.
    copy["idToken"] = keyring.current ? encryptSecret(keyring, ID_TOKEN_AAD, idToken) : null;
  }
  // The copy has the write's own keys; only token values changed.
  return copy as T;
}

/** Returns the stored ID token in the clear, or `null` when there is none or it does not open. */
export function openIdToken(keyring: Keyring, stored: string | null): string | null {
  if (!stored || !isEnvelope(stored)) return null;
  try {
    return decryptSecret(keyring, ID_TOKEN_AAD, stored);
  } catch (error) {
    if (error instanceof DataKeyError) {
      // NOTE: no requirement governs this: our own design; without the hint sign-out still ends
      // the eduLIMS session, and the IdP asks the user to confirm its own logout.
      console.error(`crypt_decrypt_fail: ${error.kind} (account id token)`);
      return null;
    }
    throw error;
  }
}

/** The better-auth `databaseHooks.account` that keep no plaintext token. */
export function accountTokenHooks(keyring: Keyring): AccountHooks {
  return {
    create: { before: async (account) => ({ data: withoutPlainTokens(keyring, account) }) },
    update: { before: async (account) => ({ data: withoutPlainTokens(keyring, account) }) },
  };
}
