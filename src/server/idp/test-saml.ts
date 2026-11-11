// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Test support: a base64 SAMLResponse whose only interesting part is the subject's NameID, for
// the sign-in gate's NameID check (the sso plugin verifies the signature before the gate runs).

/** Returns a base64 SAMLResponse naming `subject-1` with `format`, or with no Format at all. */
export function samlResponse(format: string | null): string {
  const attribute = format === null ? "" : ` Format="${format}"`;
  const xml = [
    '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"',
    ' xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">',
    "<saml:Assertion><saml:Subject>",
    `<saml:NameID${attribute}>subject-1</saml:NameID>`,
    "</saml:Subject></saml:Assertion></samlp:Response>",
  ].join("");
  return Buffer.from(xml, "utf8").toString("base64");
}
