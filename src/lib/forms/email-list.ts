// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import { m } from "@/i18n/messages";

/** What separates the entries of pasted text: commas, semicolons and line breaks. */
const ENTRY_SEPARATORS = /[,;\r\n]+/;

/** A mail client's `Name <address>` entry. */
const ANGLE = /<([^<>]*)>/;

/** Returns the candidate addresses of one entry: the bracketed one, or every word. */
function entryAddresses(entry: string): string[] {
  const bracketed = ANGLE.exec(entry);
  if (bracketed) return [bracketed[1] ?? ""];
  return entry.split(/\s+/);
}

/**
 * Returns the addresses in pasted text (a column from a spreadsheet, a line from a mail client),
 * trimmed and lower-cased, without duplicates and without the ones already in `current`. A
 * malformed entry is kept, so the schema can name it.
 */
export function parseEmailList(text: string, current: readonly string[] = []): string[] {
  const seen = new Set(current);
  const added: string[] = [];
  for (const entry of text.split(ENTRY_SEPARATORS)) {
    for (const part of entryAddresses(entry)) {
      const address = part.trim().toLowerCase();
      if (address === "" || seen.has(address)) continue;
      seen.add(address);
      added.push(address);
    }
  }
  return added;
}

const address = z.email();

/**
 * The schema of an email list field: at most `max` addresses, each a valid address. Every issue
 * belongs to the list itself, not to an item path, so the list field shows it, and the message
 * names the address it refuses.
 */
export function emailListSchema(max: number) {
  return z.array(z.string()).superRefine((list, ctx) => {
    if (list.length > max) {
      ctx.addIssue({ code: "custom", message: m.form_email_list_too_many({ max: String(max) }) });
    }
    for (const item of list) {
      if (!address.safeParse(item).success) {
        ctx.addIssue({ code: "custom", message: m.form_email_list_invalid({ address: item }) });
      }
    }
  });
}
