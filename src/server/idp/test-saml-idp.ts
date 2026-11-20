// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Test support: a SAML 2.0 identity provider in-process. It makes a fresh RSA key and a
// self-signed certificate per run (no key is committed), publishes metadata with them, and signs
// the assertion of a response, so a real ACS post runs through better-auth, the sso plugin and
// samlify's signature, audience, recipient, timestamp and InResponseTo checks.
import { createPrivateKey, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { SamlLib } from "samlify";
import { fixtureMetadata } from "./test-providers.ts";
import { PERSISTENT_NAME_ID } from "./validate.ts";

/** The IdP entity ID of the fixture metadata. */
export const STUB_SAML_ISSUER = "https://idp.example.test/saml";

function derLength(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length]);
  const bytes: number[] = [];
  for (let rest = length; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function der(tag: number, ...content: Buffer[]): Buffer {
  const body = Buffer.concat(content);
  return Buffer.concat([Buffer.from([tag]), derLength(body.length), body]);
}

function oid(dotted: string): Buffer {
  const [first = 0, second = 0, ...rest] = dotted.split(".").map(Number);
  const bytes = [first * 40 + second];
  for (const arc of rest) {
    const chunk = [arc % 128];
    for (let value = Math.floor(arc / 128); value > 0; value = Math.floor(value / 128)) {
      chunk.unshift(0x80 | (value % 128));
    }
    bytes.push(...chunk);
  }
  return der(0x06, Buffer.from(bytes));
}

function utcTime(date: Date): Buffer {
  const text = date.toISOString().replace(/[-:T]/g, "").slice(2, 14);
  return der(0x17, Buffer.from(`${text}Z`, "ascii"));
}

/** Returns a DER self-signed X.509 v3 certificate for `publicKeyDer` (SPKI), signed RS256. */
function selfSignedCertificate(
  publicKeyDer: Buffer,
  privateKeyPem: string,
  commonName: string,
): Buffer {
  const algorithm = der(0x30, oid("1.2.840.113549.1.1.11"), der(0x05));
  const name = der(0x30, der(0x31, der(0x30, oid("2.5.4.3"), der(0x0c, Buffer.from(commonName)))));
  const now = Date.now();
  const tbs = der(
    0x30,
    der(0xa0, der(0x02, Buffer.from([0x02]))),
    der(0x02, Buffer.from([0x01, ...Buffer.from(randomUUID().replaceAll("-", ""), "hex")])),
    algorithm,
    name,
    der(0x30, utcTime(new Date(now - 86_400_000)), utcTime(new Date(now + 86_400_000))),
    name,
    publicKeyDer,
  );
  const signature = sign("sha256", tbs, createPrivateKey(privateKeyPem));
  return der(0x30, tbs, algorithm, der(0x03, Buffer.from([0x00]), signature));
}

function xmlText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** What one SAML response asserts about its subject. */
export interface StubSamlSubject {
  /** The persistent NameID: the account key. */
  nameId: string;
  /** The attributes, by name, each with its values. */
  attributes: Readonly<Record<string, readonly string[]>>;
}

/** A stubbed SAML identity provider: its metadata, and a signer of login responses. */
export interface StubSamlIdp {
  metadata: string;
  /**
   * Returns a base64 SAMLResponse to `authnRequestId`, for the SP `spEntityId` at `acsUrl`, with
   * the assertion signed RSA-SHA256.
   */
  respond: (input: {
    authnRequestId: string;
    spEntityId: string;
    acsUrl: string;
    subject: StubSamlSubject;
  }) => string;
}

/** Returns a SAML identity provider stub with a fresh key and certificate. */
export function stubSamlIdp(): StubSamlIdp {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicKeyDer = publicKey.export({ type: "spki", format: "der" });
  const certificate = selfSignedCertificate(publicKeyDer, privateKeyPem, "idp.example.test");
  const certBase64 = certificate.toString("base64");
  const metadata = fixtureMetadata().replace(
    /<ds:X509Certificate>[^<]*<\/ds:X509Certificate>/,
    `<ds:X509Certificate>${certBase64}</ds:X509Certificate>`,
  );
  return {
    metadata,
    respond: ({ authnRequestId, spEntityId, acsUrl, subject }) => {
      const now = new Date();
      const instant = now.toISOString();
      const before = new Date(now.getTime() - 60_000).toISOString();
      const after = new Date(now.getTime() + 300_000).toISOString();
      const attributes = Object.entries(subject.attributes)
        .map(
          ([name, values]) =>
            `<saml:Attribute Name="${xmlText(name)}">${values
              .map((value) => `<saml:AttributeValue>${xmlText(value)}</saml:AttributeValue>`)
              .join("")}</saml:Attribute>`,
        )
        .join("");
      const xml = [
        '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"',
        ' xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"',
        ` ID="_r${randomUUID()}" Version="2.0" IssueInstant="${instant}"`,
        ` Destination="${acsUrl}" InResponseTo="${authnRequestId}">`,
        `<saml:Issuer>${STUB_SAML_ISSUER}</saml:Issuer>`,
        '<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/>',
        "</samlp:Status>",
        `<saml:Assertion ID="_a${randomUUID()}" Version="2.0" IssueInstant="${instant}">`,
        `<saml:Issuer>${STUB_SAML_ISSUER}</saml:Issuer>`,
        `<saml:Subject><saml:NameID Format="${PERSISTENT_NAME_ID}">${xmlText(subject.nameId)}`,
        '</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">',
        `<saml:SubjectConfirmationData NotOnOrAfter="${after}" Recipient="${acsUrl}"`,
        ` InResponseTo="${authnRequestId}"/></saml:SubjectConfirmation></saml:Subject>`,
        `<saml:Conditions NotBefore="${before}" NotOnOrAfter="${after}">`,
        `<saml:AudienceRestriction><saml:Audience>${xmlText(spEntityId)}</saml:Audience>`,
        "</saml:AudienceRestriction></saml:Conditions>",
        `<saml:AuthnStatement AuthnInstant="${instant}" SessionIndex="_s${randomUUID()}">`,
        "<saml:AuthnContext><saml:AuthnContextClassRef>",
        "urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport",
        "</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>",
        `<saml:AttributeStatement>${attributes}</saml:AttributeStatement>`,
        "</saml:Assertion></samlp:Response>",
      ].join("");
      const assertion = "/*[local-name(.)='Response']/*[local-name(.)='Assertion']";
      return SamlLib.constructSAMLSignature({
        rawSamlMessage: xml,
        referenceTagXPath: assertion,
        privateKey: privateKeyPem,
        signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
        signingCert: certBase64,
        isBase64Output: true,
        signatureConfig: {
          prefix: "ds",
          location: { reference: `${assertion}/*[local-name(.)='Issuer']`, action: "after" },
        },
      });
    },
  };
}

/** Returns the ID of the AuthnRequest in an HTTP-Redirect sign-in URL (SAML Bindings §3.4.4.1). */
export function authnRequestIdOf(signInUrl: string): string {
  const request = new URL(signInUrl).searchParams.get("SAMLRequest");
  if (!request) throw new Error("no SAMLRequest in the sign-in URL");
  const xml = inflateRawSync(Buffer.from(request, "base64")).toString("utf8");
  const id = /\bID="([^"]+)"/.exec(xml)?.[1];
  if (!id) throw new Error("no ID in the AuthnRequest");
  return id;
}
