// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The better-auth database adapter with secrets sealed at rest (ADR 0015). better-auth has no
// read hook and the sso plugin reads providers through the adapter, so this wraps the Kysely
// adapter: it seals `oidcConfig`/`samlConfig` secrets of `ssoProvider` on create and update and
// opens them in every row it returns, and it seals an `account`'s ID token bound to the row's
// id, inside transactions too. Relative imports: `pnpm db:seed` loads auth.ts in plain Node.
import "@tanstack/react-start/server-only";
import { randomBytes } from "node:crypto";
import { kyselyAdapter } from "@better-auth/kysely-adapter";
import type { DBAdapter, DBAdapterInstance, DBTransactionAdapter } from "better-auth";
import type { Kysely } from "kysely";
import type { DB } from "../db/schema.gen.ts";
import { logSecurityEvent } from "../security-log.ts";
import { sealAccountWrite } from "./account-tokens.ts";
import { type ConfigColumn, DataKeyError, type Keyring, openConfig, sealConfig } from "./crypto.ts";

const MODEL = "ssoProvider";
const ACCOUNT = "account";
const COLUMNS: readonly ConfigColumn[] = ["oidcConfig", "samlConfig"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Logs a key problem with the OWASP vocabulary event and the provider id only, then rethrows. */
function logged<T>(providerId: string, run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof DataKeyError) {
      logSecurityEvent("error", "crypt_decrypt_fail", {
        outcome: "failure",
        kind: error.kind,
        target_type: "identity_provider",
        target_id: providerId,
      });
    }
    throw error;
  }
}

/** Returns a row with its secrets opened; a row without a provider id is returned as is. */
export function openRow<T>(keyring: Keyring, row: T): T {
  if (!isRecord(row)) return row;
  const providerId = row["providerId"];
  if (typeof providerId !== "string") return row;
  const copy: Record<string, unknown> = { ...row };
  for (const column of COLUMNS) {
    const text = copy[column];
    if (typeof text === "string" && text !== "") {
      copy[column] = logged(providerId, () => openConfig(keyring, providerId, column, text));
    }
  }
  // The copy has the row's own keys; only the two config strings changed.
  return copy as T;
}

/**
 * Returns the write data with its secrets sealed. A write that sets a config must name the
 * provider id (in the data or in `where`), so every secret is bound to its row.
 *
 * @throws DataKeyError when a config is written without a provider id or without a key.
 */
export function sealData(
  keyring: Keyring,
  data: Record<string, unknown>,
  providerId: unknown,
): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...data };
  for (const column of COLUMNS) {
    const text = copy[column];
    if (typeof text !== "string" || text === "") continue;
    if (typeof providerId !== "string") throw new DataKeyError("malformed");
    copy[column] = sealConfig(keyring, providerId, column, text);
  }
  return copy;
}

function providerIdIn(where: readonly { field: string; value: unknown }[]): unknown {
  return where.find((clause) => clause.field === "providerId")?.value;
}

function idIn(
  where: readonly { field: string; value?: unknown; operator?: string | undefined }[],
): unknown {
  const clause = where.find((entry) => entry.field === "id");
  return clause && (clause.operator ?? "eq") === "eq" ? clause.value : undefined;
}

/** Returns the sealing and opening methods, bound to the adapter's own methods as they are now. */
function wrap(adapter: DBTransactionAdapter, keyring: Keyring): DBTransactionAdapter {
  const open = <T>(row: T): T => openRow(keyring, row);
  const own = {
    create: adapter.create.bind(adapter),
    update: adapter.update.bind(adapter),
    updateMany: adapter.updateMany.bind(adapter),
    findOne: adapter.findOne.bind(adapter),
    findMany: adapter.findMany.bind(adapter),
    consumeOne: adapter.consumeOne.bind(adapter),
  };
  return {
    ...adapter,
    create: async (input) => {
      if (input.model === ACCOUNT) {
        // The row id is chosen here, so the sealed ID token is bound to it.
        const given = input.data["id"];
        const id = typeof given === "string" ? given : randomBytes(24).toString("base64url");
        const data = { ...sealAccountWrite(keyring, id, input.data), id };
        return own.create({ ...input, data: data as typeof input.data, forceAllowId: true });
      }
      if (input.model !== MODEL) return own.create(input);
      const data = sealData(keyring, input.data, input.data["providerId"]);
      return open(await own.create({ ...input, data: data as typeof input.data }));
    },
    update: async (input) => {
      if (input.model === ACCOUNT) {
        return own.update({
          ...input,
          update: sealAccountWrite(keyring, idIn(input.where), input.update),
        });
      }
      if (input.model !== MODEL) return own.update(input);
      const update = sealData(keyring, input.update, providerIdIn(input.where));
      return open(await own.update({ ...input, update }));
    },
    updateMany: async (input) => {
      if (input.model === ACCOUNT) {
        const update = sealAccountWrite(keyring, idIn(input.where), input.update);
        return own.updateMany({ ...input, update });
      }
      if (input.model !== MODEL) return own.updateMany(input);
      const update = sealData(keyring, input.update, providerIdIn(input.where));
      return own.updateMany({ ...input, update });
    },
    findOne: async <T>(input: Parameters<DBTransactionAdapter["findOne"]>[0]) => {
      const row = await own.findOne<T>(input);
      return input.model === MODEL ? open(row) : row;
    },
    findMany: async <T>(input: Parameters<DBTransactionAdapter["findMany"]>[0]) => {
      const rows = await own.findMany<T>(input);
      return input.model === MODEL ? rows.map(open) : rows;
    },
    consumeOne: async <T>(input: Parameters<DBTransactionAdapter["consumeOne"]>[0]) => {
      const row = await own.consumeOne<T>(input);
      return input.model === MODEL ? open(row) : row;
    },
  };
}

/** The `database` value createAuth accepts: a Kysely instance and whether it may open transactions. */
export interface KyselyDatabase {
  db: Kysely<DB>;
  type: "postgres";
  transaction?: boolean | undefined;
}

/**
 * Returns better-auth's Kysely adapter on `database`, with the `ssoProvider` secrets sealed at
 * rest under `keyring`. Native transactions stay on, because the sso plugin finalises the
 * account inside one (`runWithTransaction`).
 */
export function encryptedKyselyAdapter(
  database: KyselyDatabase,
  keyring: Keyring,
): DBAdapterInstance {
  const factory = kyselyAdapter(database.db, {
    type: database.type,
    transaction: database.transaction ?? true,
  });
  return (options) => {
    const instance: DBAdapter = factory(options);
    const transaction = instance.transaction.bind(instance);
    // Keeps the instance itself, which better-auth's schema check is registered on.
    Object.assign(instance, wrap(instance, keyring), {
      transaction: <R>(callback: (trx: DBTransactionAdapter) => Promise<R>) =>
        transaction((trx) => callback(wrap(trx, keyring))),
    });
    return instance;
  };
}
