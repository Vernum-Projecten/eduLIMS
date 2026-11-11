// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { listUsersInput, userListSearchSchema } from "./schemas.ts";
import {
  hasUserFilters,
  listInputFromSearch,
  nextUsersSearch,
  onlySearchTextChanged,
  usersTableState,
} from "./table-state.ts";

const parse = (search: Record<string, unknown>) => userListSearchSchema.parse(search);

describe("userListSearchSchema (#58)", () => {
  it("reads the facets as arrays of known values", () => {
    expect(parse({ role: ["teacher", "admin"], status: ["blocked"] })).toMatchObject({
      role: ["teacher", "admin"],
      status: ["blocked"],
    });
  });

  it("accepts a single value from an older link as one", () => {
    expect(parse({ role: "teacher", provider: "keycloak" })).toMatchObject({
      role: ["teacher"],
      provider: ["keycloak"],
    });
  });

  it("drops unknown values and duplicates, and no value means no filter", () => {
    expect(parse({ role: ["teacher", "root", "teacher"] }).role).toEqual(["teacher"]);
    expect(parse({ status: ["nope"] }).status).toBeUndefined();
    expect(parse({ provider: 42 }).provider).toBeUndefined();
    expect(parse({ role: Array.from({ length: 50 }, () => "teacher") }).role).toBeUndefined();
  });

  it("trims and cuts the search text; blank is no search", () => {
    expect(parse({ q: "  anna  " }).q).toBe("anna");
    expect(parse({ q: "   " }).q).toBeUndefined();
    expect(parse({ q: "x".repeat(300) }).q).toHaveLength(100);
  });
});

describe("listUsersInput refuses what the URL schema repairs (A05)", () => {
  it.each([
    [{ role: "teacher" }],
    [{ role: [] }],
    [{ role: ["root"] }],
    [{ provider: ["microsoft", "microsoft", "microsoft", "microsoft"] }],
    [{ status: ["active"], extra: true }],
  ])("refuses %j", (input) => {
    expect(listUsersInput.safeParse(input).success).toBe(false);
  });
});

describe("usersTableState (#58)", () => {
  it("defaults to sorting by name, the first page of 25 and no filter", () => {
    expect(usersTableState(parse({}))).toEqual({
      sorting: [{ id: "name", desc: false }],
      columnFilters: [],
      pagination: { pageIndex: 0, pageSize: 25 },
    });
  });

  it("maps the search text and the facets to their columns", () => {
    const state = usersTableState(
      parse({ q: "anna", role: ["admin"], provider: ["keycloak"], status: ["never"] }),
    );
    expect(state.columnFilters).toEqual([
      { id: "name", value: "anna" },
      { id: "roles", value: ["admin"] },
      { id: "providers", value: ["keycloak"] },
      { id: "status", value: ["never"] },
    ]);
  });

  it("maps the sort and the page", () => {
    const state = usersTableState(parse({ sort: "lastSignIn", dir: "desc", page: 3, size: 10 }));
    expect(state.sorting).toEqual([{ id: "lastSignIn", desc: true }]);
    expect(state.pagination).toEqual({ pageIndex: 2, pageSize: 10 });
  });
});

describe("nextUsersSearch (#58)", () => {
  const prev = parse({ q: "a", role: ["student"], page: 3, size: 10 });

  it("starts a new sort at the first page", () => {
    expect(nextUsersSearch(prev, { sorting: [{ id: "lastSignIn", desc: true }] })).toMatchObject({
      sort: "lastSignIn",
      dir: "desc",
      page: undefined,
      q: "a",
    });
  });

  it("starts a new filter at the first page and validates its values", () => {
    const next = nextUsersSearch(prev, {
      columnFilters: [
        { id: "roles", value: ["teacher", "bogus"] },
        { id: "status", value: ["blocked"] },
      ],
    });
    expect(next).toMatchObject({ role: ["teacher"], status: ["blocked"], page: undefined });
    expect(next.q).toBeUndefined();
  });

  it("clears every filter on reset", () => {
    expect(nextUsersSearch(prev, { columnFilters: [] })).toMatchObject({
      q: undefined,
      role: undefined,
      provider: undefined,
      status: undefined,
    });
  });

  it("moves to another page and keeps the filters", () => {
    expect(nextUsersSearch(prev, { pagination: { pageIndex: 3, pageSize: 10 } })).toMatchObject({
      page: 4,
      size: 10,
      role: ["student"],
    });
  });

  it("starts a new page size at the first page", () => {
    expect(nextUsersSearch(prev, { pagination: { pageIndex: 1, pageSize: 50 } })).toMatchObject({
      page: undefined,
      size: 50,
    });
  });

  it("round-trips the table state through the URL", () => {
    const search = parse({ q: "x", provider: ["microsoft"], sort: "lastSignIn", page: 2 });
    const state = usersTableState(search);
    const again = nextUsersSearch(nextUsersSearch(search, { sorting: state.sorting }), {
      columnFilters: state.columnFilters,
    });
    expect(usersTableState({ ...again, page: 2 })).toEqual(state);
  });
});

describe("the search helpers (#58)", () => {
  it("replaces the history entry only when the search text alone changed", () => {
    const prev = parse({ q: "a", role: ["student"] });
    expect(onlySearchTextChanged(prev, { ...prev, q: "ab" })).toBe(true);
    expect(onlySearchTextChanged(prev, { ...prev, q: "ab", role: ["teacher"] })).toBe(false);
    expect(onlySearchTextChanged(prev, { ...prev, role: ["teacher"] })).toBe(false);
  });

  it("knows when the list is narrowed", () => {
    expect(hasUserFilters(parse({ sort: "name", page: 2 }))).toBe(false);
    expect(hasUserFilters(parse({ status: ["never"] }))).toBe(true);
  });

  it("builds a strict server input without empty keys", () => {
    const input = listInputFromSearch(parse({ q: "a", role: ["admin"], dir: "desc", page: 2 }));
    expect(input).toEqual({ q: "a", role: ["admin"], dir: "desc", page: 2 });
    expect(listUsersInput.parse(input)).toEqual(input);
    expect(listInputFromSearch(parse({}))).toEqual({});
  });
});
