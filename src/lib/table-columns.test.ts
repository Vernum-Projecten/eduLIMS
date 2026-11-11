// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  columnsCookieName,
  hiddenColumnsCookie,
  hiddenFromVisibility,
  parseHiddenColumns,
  visibilityFromHidden,
} from "./table-columns.ts";

describe("the hidden-columns preference (#58)", () => {
  it("names the cookie after the table", () => {
    expect(columnsCookieName("admin-users")).toBe("EDULIMS_COLUMNS_ADMIN_USERS");
  });

  it("refuses a table id that is not a short kebab-case id", () => {
    expect(() => columnsCookieName("Admin Users")).toThrow(Error);
    expect(() => columnsCookieName("")).toThrow(Error);
  });

  it("parses the ids, dropping anything that is not a column id and duplicates", () => {
    expect(parseHiddenColumns(undefined)).toEqual([]);
    expect(parseHiddenColumns("")).toEqual([]);
    expect(parseHiddenColumns("sessions.providers.sessions")).toEqual(["sessions", "providers"]);
    expect(parseHiddenColumns("roles.<script>.a b.status")).toEqual(["roles", "status"]);
  });

  it("caps the number of ids", () => {
    const many = Array.from({ length: 50 }, (_, i) => `c${i}`).join(".");
    expect(parseHiddenColumns(many)).toHaveLength(32);
  });

  it("writes a site-wide preference cookie without a comma, secure over https", () => {
    expect(hiddenColumnsCookie("admin-users", ["sessions", "roles"], false)).toBe(
      "EDULIMS_COLUMNS_ADMIN_USERS=sessions.roles; path=/; max-age=31536000; samesite=lax",
    );
    expect(hiddenColumnsCookie("admin-users", [], true)).toBe(
      "__Host-EDULIMS_COLUMNS_ADMIN_USERS=; path=/; max-age=31536000; samesite=lax; secure",
    );
  });

  it("maps hidden ids to column visibility and back; only false hides", () => {
    expect(visibilityFromHidden(["sessions"])).toEqual({ sessions: false });
    expect(hiddenFromVisibility({ sessions: false, roles: true, status: false })).toEqual([
      "sessions",
      "status",
    ]);
  });
});
