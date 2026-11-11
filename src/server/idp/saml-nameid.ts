// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The NameID format of a SAML sign-in (#46, ADR 0015; security review L8). The account key is
// the NameID, so only the persistent format may sign in: a transient or email NameID changes
// between sign-ins or can be reassigned. The sign-in gate reads the SAMLResponse the sso plugin
// has already verified. Relative imports: `pnpm db:seed` loads auth.ts in plain Node.
import "@tanstack/react-start/server-only";
import { PERSISTENT_NAME_ID } from "./validate.ts";

/** Returns the `Format` of every `NameID` in a base64 SAMLResponse, `""` where it has none. */
export function samlNameIdFormats(samlResponse: unknown): string[] {
  if (typeof samlResponse !== "string" || samlResponse === "") return [];
  const xml = Buffer.from(samlResponse, "base64").toString("utf8");
  const formats: string[] = [];
  for (const match of xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?NameID\b([^>]*)>/g)) {
    const format = /\bFormat\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(match[1] ?? "");
    formats.push(format?.[1] ?? format?.[2] ?? "");
  }
  return formats;
}

/**
 * Returns whether a SAMLResponse names its subject with the persistent format only. An encrypted
 * or missing NameID counts as not persistent.
 */
export function hasPersistentNameId(samlResponse: unknown): boolean {
  const formats = samlNameIdFormats(samlResponse);
  return formats.length > 0 && formats.every((format) => format === PERSISTENT_NAME_ID);
}
