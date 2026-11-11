// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The hidden columns of a data table (#58), kept per browser in a preference cookie like the
// theme: a display preference, not part of a view anyone shares, so it stays out of the URL.
// The server reads the cookie during SSR, so the table renders its columns without a flash.
import type { ColumnVisibilityState } from "@tanstack/react-table";
import { preferenceCookie } from "./cookies.ts";

/** One year, in seconds. */
export const COLUMNS_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const TABLE_ID = /^[a-z][a-z0-9-]{0,31}$/;
const COLUMN_ID = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const MAX_HIDDEN = 32;
// NOTE: RFC 6265 §4.1.1: a cookie value cannot hold a comma, so the ids are joined with a dot.
const SEPARATOR = ".";

/**
 * Returns the base name of the hidden-columns cookie of table `tableId` (`admin-users` gives
 * `EDULIMS_COLUMNS_ADMIN_USERS`); over https it carries the `__Host-` prefix.
 *
 * @throws Error when `tableId` is not a short lower-case kebab-case id.
 */
export function columnsCookieName(tableId: string): string {
  if (!TABLE_ID.test(tableId)) throw new Error(`invalid table id: ${tableId}`);
  return `EDULIMS_COLUMNS_${tableId.toUpperCase().replaceAll("-", "_")}`;
}

/** Returns the hidden column ids in a cookie value; anything that is not a column id is dropped. */
export function parseHiddenColumns(value: string | undefined): string[] {
  if (!value) return [];
  const ids = value.split(SEPARATOR).filter((id) => COLUMN_ID.test(id));
  return [...new Set(ids)].slice(0, MAX_HIDDEN);
}

/** The `document.cookie` assignment that stores the hidden columns of table `tableId`. */
export function hiddenColumnsCookie(
  tableId: string,
  hidden: readonly string[],
  secure: boolean,
): string {
  const value = parseHiddenColumns(hidden.join(SEPARATOR)).join(SEPARATOR);
  return preferenceCookie(columnsCookieName(tableId), value, COLUMNS_COOKIE_MAX_AGE, secure);
}

/** Returns the table's column visibility for a list of hidden column ids. */
export function visibilityFromHidden(hidden: readonly string[]): ColumnVisibilityState {
  return Object.fromEntries(hidden.map((id) => [id, false]));
}

/** Returns the hidden column ids of a column visibility: only an explicit `false` hides one. */
export function hiddenFromVisibility(visibility: ColumnVisibilityState): string[] {
  return Object.entries(visibility)
    .filter(([, visible]) => visible === false)
    .map(([id]) => id);
}
