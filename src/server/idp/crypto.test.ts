// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DataKeyError,
  dataKey,
  decryptSecret,
  encryptSecret,
  envelopeKid,
  isEnvelope,
  type Keyring,
  keyringOf,
  openConfig,
  resealConfig,
  sealConfig,
  secretAad,
  secretsPresent,
} from "./crypto.ts";

const KEY_A = randomBytes(32).toString("base64");
const KEY_B = randomBytes(32).toString("base64");
const ring = (current: string | null, previous: string | null = null): Keyring => ({
  current: current ? dataKey(current) : null,
  previous: previous ? dataKey(previous) : null,
});
const AAD = secretAad("entra", "oidcConfig", "clientSecret");

function kind(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof DataKeyError ? error.kind : "other";
  }
}

describe("field encryption (ASVS V11.3.2, V11.3.3)", () => {
  it("round-trips a secret through AES-256-GCM", () => {
    const sealed = encryptSecret(ring(KEY_A), AAD, "s3cret");
    expect(sealed).toMatch(
      /^enc:v1:[A-Za-z0-9_-]{8}:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{22}$/,
    );
    expect(sealed).not.toContain("s3cret");
    expect(decryptSecret(ring(KEY_A), AAD, sealed)).toBe("s3cret");
  });

  it("uses a fresh IV per seal, so equal secrets differ at rest", () => {
    expect(encryptSecret(ring(KEY_A), AAD, "x")).not.toBe(encryptSecret(ring(KEY_A), AAD, "x"));
  });

  it("refuses a ciphertext moved to another provider or field (AAD)", () => {
    const sealed = encryptSecret(ring(KEY_A), AAD, "s3cret");
    const otherRow = secretAad("keycloak", "oidcConfig", "clientSecret");
    const otherField = secretAad("entra", "samlConfig", "privateKey");
    expect(kind(() => decryptSecret(ring(KEY_A), otherRow, sealed))).toBe("tampered");
    expect(kind(() => decryptSecret(ring(KEY_A), otherField, sealed))).toBe("tampered");
  });

  it("detects a changed ciphertext or tag", () => {
    const sealed = encryptSecret(ring(KEY_A), AAD, "s3cret");
    const parts = sealed.split(":");
    const flip = (text: string) =>
      `${text.slice(0, -2)}${text.at(-2) === "A" ? "B" : "A"}${text.at(-1)}`;
    const badCipher = [...parts.slice(0, 4), flip(parts[4] ?? ""), parts[5]].join(":");
    const badTag = [...parts.slice(0, 5), flip(parts[5] ?? "")].join(":");
    expect(kind(() => decryptSecret(ring(KEY_A), AAD, badCipher))).toBe("tampered");
    expect(kind(() => decryptSecret(ring(KEY_A), AAD, badTag))).toBe("tampered");
  });

  it("refuses a key it does not know, and no key at all", () => {
    const sealed = encryptSecret(ring(KEY_A), AAD, "s3cret");
    expect(kind(() => decryptSecret(ring(KEY_B), AAD, sealed))).toBe("unknown_key");
    expect(kind(() => decryptSecret(ring(null), AAD, sealed))).toBe("missing_key");
  });

  it("refuses to seal without a key and to open plaintext or a malformed envelope", () => {
    expect(kind(() => encryptSecret(ring(null), AAD, "s3cret"))).toBe("missing_key");
    expect(kind(() => decryptSecret(ring(KEY_A), AAD, "s3cret"))).toBe("plaintext");
    expect(kind(() => decryptSecret(ring(KEY_A), AAD, "enc:v1:abc"))).toBe("malformed");
    expect(kind(() => dataKey(Buffer.from("short").toString("base64")))).toBe("malformed");
  });

  it("opens with the previous key during a rotation and reseals under the new one", () => {
    const old = sealConfig(
      ring(KEY_A),
      "entra",
      "oidcConfig",
      JSON.stringify({ clientSecret: "x" }),
    );
    const rotating = ring(KEY_B, KEY_A);
    const resealed = resealConfig(rotating, "entra", "oidcConfig", old);
    const secret: unknown = Reflect.get(JSON.parse(resealed), "clientSecret");
    expect(envelopeKid(secret)).toBe(dataKey(KEY_B).kid);
    expect(JSON.parse(openConfig(ring(KEY_B), "entra", "oidcConfig", resealed))).toEqual({
      clientSecret: "x",
    });
  });

  it("builds the keyring from the environment", () => {
    expect(keyringOf({ EDULIMS_DATA_KEY: KEY_A }).current?.kid).toBe(dataKey(KEY_A).kid);
    expect(keyringOf({}).current).toBeNull();
  });
});

describe("provider configs", () => {
  const saml = {
    issuer: "https://edulims.example/sp",
    privateKey: "-----BEGIN PRIVATE KEY-----a-----END PRIVATE KEY-----",
    idpMetadata: { metadata: "<xml/>", privateKeyPass: "pass" },
    spMetadata: { privateKey: "key", encPrivateKey: "enc", encPrivateKeyPass: "pass2" },
  };

  it("seals every SAML private key and passphrase, and leaves the rest readable", () => {
    const sealed = JSON.parse(sealConfig(ring(KEY_A), "s", "samlConfig", JSON.stringify(saml)));
    expect(sealed.issuer).toBe(saml.issuer);
    expect(sealed.idpMetadata.metadata).toBe("<xml/>");
    for (const value of [
      sealed.privateKey,
      sealed.idpMetadata.privateKeyPass,
      sealed.spMetadata.privateKey,
      sealed.spMetadata.encPrivateKey,
      sealed.spMetadata.encPrivateKeyPass,
    ]) {
      expect(isEnvelope(value)).toBe(true);
    }
    expect(JSON.parse(openConfig(ring(KEY_A), "s", "samlConfig", JSON.stringify(sealed)))).toEqual(
      saml,
    );
  });

  it("keeps an already sealed secret as it is", () => {
    const once = sealConfig(ring(KEY_A), "e", "oidcConfig", JSON.stringify({ clientSecret: "x" }));
    expect(sealConfig(ring(KEY_A), "e", "oidcConfig", once)).toBe(once);
  });

  it("fails closed on a stored plaintext secret or a config that is not an object", () => {
    const plain = JSON.stringify({ clientSecret: "x" });
    expect(kind(() => openConfig(ring(KEY_A), "e", "oidcConfig", plain))).toBe("plaintext");
    expect(kind(() => openConfig(ring(KEY_A), "e", "oidcConfig", "[1]"))).toBe("malformed");
    expect(kind(() => openConfig(ring(KEY_A), "e", "oidcConfig", "{"))).toBe("malformed");
  });

  it("names the secrets that are set, for the write-only markers", () => {
    expect(secretsPresent("oidcConfig", JSON.stringify({ clientSecret: "x" }))).toEqual([
      "clientSecret",
    ]);
    expect(secretsPresent("oidcConfig", JSON.stringify({ clientSecret: "" }))).toEqual([]);
    expect(secretsPresent("samlConfig", null)).toEqual([]);
  });
});
