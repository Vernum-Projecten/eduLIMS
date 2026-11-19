// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The administrator's list of simulations in the URL (B5, #291): the search params a link may
// carry, the server function's strict input with its page-size allow-list, and the mapping
// between the URL and the table's slices.
import { describe, expect, it } from "vitest";
import {
  ADMIN_SIMULATION_SEARCH_MAX_LENGTH,
  adminSimulationListSearchSchema,
  listAdminSimulationsInput,
} from "./admin-schemas.ts";
import {
  adminSimulationListInput,
  adminSimulationsTableState,
  nextAdminSimulationsSearch,
  onlyAdminSimulationSearchChanged,
} from "./admin-table-state.ts";

describe("adminSimulationListSearchSchema (the URL)", () => {
  it("keeps a valid search, page and size", () => {
    expect(adminSimulationListSearchSchema.parse({ q: " Lab ", page: "2", size: "50" })).toEqual({
      q: "Lab",
      page: 2,
      size: 50,
    });
  });

  it("drops what a hand-edited link gets wrong instead of failing", () => {
    expect(
      adminSimulationListSearchSchema.parse({ q: "   ", page: "0", size: "7", sort: "name" }),
    ).toEqual({ q: undefined, page: undefined, size: undefined });
  });

  it("cuts a long search to the maximum length", () => {
    const parsed = adminSimulationListSearchSchema.parse({ q: "x".repeat(500) });
    expect(parsed.q).toHaveLength(ADMIN_SIMULATION_SEARCH_MAX_LENGTH);
  });
});

describe("listAdminSimulationsInput (the server function is an API)", () => {
  it("accepts the page sizes of the allow-list", () => {
    for (const size of [10, 25, 50, 100]) {
      expect(listAdminSimulationsInput.safeParse({ size }).success).toBe(true);
    }
  });

  it.each([
    ["a page size outside the allow-list", { size: 1000 }],
    ["a page below one", { page: 0 }],
    ["a fractional page", { page: 1.5 }],
    ["a search over the maximum length", { q: "x".repeat(ADMIN_SIMULATION_SEARCH_MAX_LENGTH + 1) }],
    ["an unknown key", { sort: "name" }],
  ])("refuses %s", (_case, input) => {
    expect(listAdminSimulationsInput.safeParse(input).success).toBe(false);
  });
});

describe("the list's URL state", () => {
  it("maps the search to the name column and the page to a zero-based index", () => {
    expect(adminSimulationsTableState({ q: "Lab", page: 3, size: 10 })).toEqual({
      columnFilters: [{ id: "name", value: "Lab" }],
      pagination: { pageIndex: 2, pageSize: 10 },
    });
    expect(adminSimulationsTableState({})).toEqual({
      columnFilters: [],
      pagination: { pageIndex: 0, pageSize: 25 },
    });
  });

  it("starts a new search at the first page", () => {
    expect(
      nextAdminSimulationsSearch(
        { q: "old", page: 4, size: 10 },
        { columnFilters: [{ id: "name", value: "new" }] },
      ),
    ).toEqual({ q: "new", page: undefined, size: 10 });
  });

  it("moves to another page, and back to the first on a new page size", () => {
    expect(
      nextAdminSimulationsSearch({ size: 10 }, { pagination: { pageIndex: 1, pageSize: 10 } }),
    ).toEqual({ size: 10, page: 2 });
    expect(
      nextAdminSimulationsSearch(
        { page: 3, size: 10 },
        { pagination: { pageIndex: 2, pageSize: 50 } },
      ),
    ).toEqual({ size: 50, page: undefined });
  });

  it("ignores a sorting change: the order is fixed", () => {
    const prev = { q: "Lab", page: 2 };
    expect(nextAdminSimulationsSearch(prev, { sorting: [{ id: "name", desc: true }] })).toBe(prev);
  });

  it("replaces the history entry only while the search text alone changes", () => {
    expect(onlyAdminSimulationSearchChanged({ q: "a" }, { q: "ab" })).toBe(true);
    expect(onlyAdminSimulationSearchChanged({ q: "a" }, { q: "a", page: 2 })).toBe(false);
    expect(onlyAdminSimulationSearchChanged({ q: "a", size: 10 }, { q: "b", size: 50 })).toBe(
      false,
    );
  });

  it("sends only the keys that are set", () => {
    expect(adminSimulationListInput({})).toEqual({});
    expect(adminSimulationListInput({ q: "Lab", page: 2, size: 50 })).toEqual({
      q: "Lab",
      page: 2,
      size: 50,
    });
  });
});
