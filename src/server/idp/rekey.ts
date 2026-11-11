// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Data-key rotation (#46, ADR 0015; ASVS V11.1.1): `idp rekey` re-encrypts every secret eduLIMS
// sealed under `EDULIMS_DATA_KEY_PREVIOUS` with `EDULIMS_DATA_KEY`. Relative imports: the host
// CLI loads this in plain Node.
import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import type { DB } from "../db/schema.gen.ts";
import { resealIdToken } from "./account-tokens.ts";
import { isEnvelope, type Keyring, resealConfig } from "./crypto.ts";
import { invalidateProviderCache } from "./registry.ts";

/**
 * Re-encrypts the provider configs and the accounts' sealed ID tokens under the current key, in
 * one transaction, and returns how many of each.
 *
 * @throws DataKeyError when a secret opens with neither key; nothing is written then.
 */
export async function rekeySecrets(
  db: Kysely<DB>,
  keyring: Keyring,
): Promise<{ providers: number; idTokens: number }> {
  const providers = await db
    .selectFrom("ssoProvider")
    .select(["providerId", "oidcConfig", "samlConfig"])
    .execute();
  const accounts = (
    await db
      .selectFrom("account")
      .select(["id", "idToken"])
      .where("idToken", "is not", null)
      .execute()
  ).filter((account) => isEnvelope(account.idToken));
  await db.transaction().execute(async (trx) => {
    for (const row of providers) {
      await trx
        .updateTable("ssoProvider")
        .set({
          oidcConfig: row.oidcConfig
            ? resealConfig(keyring, row.providerId, "oidcConfig", row.oidcConfig)
            : null,
          samlConfig: row.samlConfig
            ? resealConfig(keyring, row.providerId, "samlConfig", row.samlConfig)
            : null,
        })
        .where("providerId", "=", row.providerId)
        .execute();
    }
    for (const account of accounts) {
      await trx
        .updateTable("account")
        .set({ idToken: resealIdToken(keyring, account.id, String(account.idToken)) })
        .where("id", "=", account.id)
        .execute();
    }
  });
  invalidateProviderCache();
  return { providers: providers.length, idTokens: accounts.length };
}
