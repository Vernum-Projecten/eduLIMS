// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Field-level encryption of identity-provider secrets at rest (ADR 0015; ASVS V11.3.2, V11.3.3,
// V13.3.1): AES-256-GCM from node:crypto with a 96-bit random IV, and the provider id plus the
// JSON path as additional authenticated data, so a ciphertext cannot move between rows or
// fields. The key is `EDULIMS_DATA_KEY`, separate from `BETTER_AUTH_SECRET`.
// Relative imports: the host CLIs load this in plain Node.
import "@tanstack/react-start/server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Why a secret could not be encrypted or decrypted; the log records only this code. */
export type DataKeyProblem = "missing_key" | "unknown_key" | "malformed" | "tampered" | "plaintext";

/** Thrown when a secret cannot be encrypted or decrypted; it never carries the secret. */
export class DataKeyError extends Error {
  readonly kind: DataKeyProblem;
  constructor(kind: DataKeyProblem) {
    super(`identity-provider secret: ${kind}`);
    this.name = "DataKeyError";
    this.kind = kind;
  }
}

/** One AES-256 key and its short id, which the envelope names. */
export interface DataKey {
  kid: string;
  key: Buffer;
}

/** The key that encrypts, and the keys that may still decrypt (rotation). */
export interface Keyring {
  current: DataKey | null;
  previous: DataKey | null;
}

/** Returns the key for a base64 `EDULIMS_DATA_KEY` value; its id is a prefix of its SHA-256. */
export function dataKey(base64: string): DataKey {
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) throw new DataKeyError("malformed");
  const kid = createHash("sha256").update(key).digest("base64url").slice(0, 8);
  return { kid, key };
}

/** Returns the keyring of the environment's `EDULIMS_DATA_KEY` and `EDULIMS_DATA_KEY_PREVIOUS`. */
export function keyringOf(env: {
  EDULIMS_DATA_KEY?: string | undefined;
  EDULIMS_DATA_KEY_PREVIOUS?: string | undefined;
}): Keyring {
  return {
    current: env.EDULIMS_DATA_KEY ? dataKey(env.EDULIMS_DATA_KEY) : null,
    previous: env.EDULIMS_DATA_KEY_PREVIOUS ? dataKey(env.EDULIMS_DATA_KEY_PREVIOUS) : null,
  };
}

/** Returns whether `value` is an encrypted envelope. */
export function isEnvelope(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/** Returns the id of the key that sealed an envelope, or `null` for anything else. */
export function envelopeKid(value: unknown): string | null {
  if (!isEnvelope(value)) return null;
  return value.slice(PREFIX.length).split(":")[0] ?? null;
}

/** Encrypts `plaintext` for one field: `enc:v1:<kid>:<iv>:<ciphertext>:<tag>`, base64url. */
export function encryptSecret(keyring: Keyring, aad: string, plaintext: string): string {
  const current = keyring.current;
  if (!current) throw new DataKeyError("missing_key");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", current.key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const parts = [current.kid, iv, ciphertext, cipher.getAuthTag()].map((part) =>
    typeof part === "string" ? part : part.toString("base64url"),
  );
  return `${PREFIX}${parts.join(":")}`;
}

/**
 * Decrypts an envelope of one field.
 *
 * @throws DataKeyError when no key has its id, the envelope is malformed, or the ciphertext,
 *   the tag or the field (`aad`) does not match.
 */
export function decryptSecret(keyring: Keyring, aad: string, envelope: string): string {
  if (!isEnvelope(envelope)) throw new DataKeyError("plaintext");
  const [kid, iv, ciphertext, tag, ...rest] = envelope.slice(PREFIX.length).split(":");
  if (!kid || !iv || ciphertext === undefined || !tag || rest.length > 0) {
    throw new DataKeyError("malformed");
  }
  const key = [keyring.current, keyring.previous].find((candidate) => candidate?.kid === kid);
  if (!key) throw new DataKeyError(keyring.current ? "unknown_key" : "missing_key");
  const ivBytes = Buffer.from(iv, "base64url");
  const tagBytes = Buffer.from(tag, "base64url");
  if (ivBytes.length !== IV_BYTES || tagBytes.length !== TAG_BYTES) {
    throw new DataKeyError("malformed");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key.key, ivBytes, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tagBytes);
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new DataKeyError("tampered");
  }
}

/** The config columns of `ssoProvider` that hold JSON with secrets. */
export type ConfigColumn = "oidcConfig" | "samlConfig";

/** The JSON paths of the secrets per config column (the plugin's `withoutOIDCSecret` set). */
export const SECRET_PATHS: Readonly<Record<ConfigColumn, readonly string[]>> = {
  oidcConfig: ["clientSecret"],
  samlConfig: [
    "privateKey",
    "spMetadata.privateKey",
    "spMetadata.privateKeyPass",
    "spMetadata.encPrivateKey",
    "spMetadata.encPrivateKeyPass",
    "idpMetadata.privateKey",
    "idpMetadata.privateKeyPass",
    "idpMetadata.encPrivateKey",
    "idpMetadata.encPrivateKeyPass",
  ],
};

/** Returns the additional authenticated data of one secret: the row and the field. */
export function secretAad(providerId: string, column: ConfigColumn, path: string): string {
  return `edulims:ssoProvider:${providerId}:${column}.${path}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapSecrets(
  config: Record<string, unknown>,
  column: ConfigColumn,
  map: (path: string, value: string) => string,
): Record<string, unknown> {
  const copy = structuredClone(config);
  for (const path of SECRET_PATHS[column]) {
    const keys = path.split(".");
    const last = keys.pop();
    let holder: unknown = copy;
    for (const key of keys) holder = isRecord(holder) ? holder[key] : undefined;
    if (!last || !isRecord(holder)) continue;
    const value = holder[last];
    if (typeof value === "string" && value !== "") holder[last] = map(path, value);
  }
  return copy;
}

function parseConfig(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new DataKeyError("malformed");
  }
  if (!isRecord(parsed)) throw new DataKeyError("malformed");
  return parsed;
}

/** Returns a config JSON text with every secret sealed; a sealed secret stays as it is. */
export function sealConfig(
  keyring: Keyring,
  providerId: string,
  column: ConfigColumn,
  text: string,
): string {
  const sealed = mapSecrets(parseConfig(text), column, (path, value) =>
    isEnvelope(value) ? value : encryptSecret(keyring, secretAad(providerId, column, path), value),
  );
  return JSON.stringify(sealed);
}

/**
 * Returns a config JSON text with every secret opened.
 *
 * @throws DataKeyError when a secret is stored in plaintext or cannot be decrypted (fail closed).
 */
export function openConfig(
  keyring: Keyring,
  providerId: string,
  column: ConfigColumn,
  text: string,
): string {
  const opened = mapSecrets(parseConfig(text), column, (path, value) =>
    decryptSecret(keyring, secretAad(providerId, column, path), value),
  );
  return JSON.stringify(opened);
}

/** Returns the config with every secret re-sealed under the current key (`pnpm idp:rekey`). */
export function resealConfig(
  keyring: Keyring,
  providerId: string,
  column: ConfigColumn,
  text: string,
): string {
  const opened = openConfig(keyring, providerId, column, text);
  const fresh = mapSecrets(parseConfig(opened), column, (path, value) =>
    encryptSecret(keyring, secretAad(providerId, column, path), value),
  );
  return JSON.stringify(fresh);
}

/** Returns which secret paths of a config hold a value, for the write-only "set" markers. */
export function secretsPresent(column: ConfigColumn, text: string | null): string[] {
  if (!text) return [];
  const present: string[] = [];
  mapSecrets(parseConfig(text), column, (path, value) => {
    present.push(path);
    return value;
  });
  return present;
}
