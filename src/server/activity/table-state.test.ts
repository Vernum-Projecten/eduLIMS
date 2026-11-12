// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { activityListSearchSchema, activityUserSearchInput, listActivityInput } from "./schemas.ts";
import {
  activityTableState,
  hasActivityFilters,
  listInputFromSearch,
  nextActivitySearch,
  periodOf,
} from "./table-state.ts";

const parse = (search: Record<string, unknown>) => activityListSearchSchema.parse(search);

describe("activityListSearchSchema (#36)", () => {
  it("reads the facets as arrays of known values, a single value as one", () => {
    expect(parse({ action: "user_banned", outcome: ["refused", "failure"] })).toMatchObject({
      action: ["user_banned"],
      outcome: ["failure", "refused"],
    });
  });

  it("drops unknown values and keys that do not parse, instead of failing", () => {
    expect(
      parse({ action: ["drop_table"], outcome: "maybe", from: "2026-02-30", dir: "up", size: 7 }),
    ).toEqual({
      actor: undefined,
      target: undefined,
      action: undefined,
      outcome: undefined,
      from: undefined,
      to: undefined,
      dir: undefined,
      page: undefined,
      size: undefined,
    });
  });

  it("reads a period that ends before it starts the other way round", () => {
    expect(parse({ from: "2026-11-10", to: "2026-11-01" })).toMatchObject({
      from: "2026-11-01",
      to: "2026-11-10",
    });
  });
});

describe("listActivityInput (#36)", () => {
  it("refuses unknown keys, unknown actions and a reversed period", () => {
    expect(listActivityInput.safeParse({ q: "x" }).success).toBe(false);
    expect(listActivityInput.safeParse({ action: ["drop_table"] }).success).toBe(false);
    expect(listActivityInput.safeParse({ from: "2026-11-10", to: "2026-11-01" }).success).toBe(
      false,
    );
    expect(listActivityInput.safeParse({ size: 1000 }).success).toBe(false);
  });

  it("accepts a full filter", () => {
    const input = {
      actor: "u-1",
      target: "u-2",
      action: ["user_banned"],
      outcome: ["success"],
      from: "2026-11-01",
      to: "2026-11-01",
      dir: "asc",
      page: 2,
      size: 50,
    };
    expect(listActivityInput.parse(input)).toEqual(input);
  });
});

describe("activityUserSearchInput (#36)", () => {
  it("trims and refuses an empty or overlong search", () => {
    expect(activityUserSearchInput.parse({ q: "  anna " })).toEqual({ q: "anna" });
    expect(activityUserSearchInput.safeParse({ q: "   " }).success).toBe(false);
    expect(activityUserSearchInput.safeParse({ q: "a".repeat(101) }).success).toBe(false);
  });
});

describe("the activity table state in the URL (#36)", () => {
  it("sorts newest first by default and puts the period on the time column", () => {
    const state = activityTableState(parse({ actor: "u-1", from: "2026-11-01" }));
    expect(state.sorting).toEqual([{ id: "occurredAt", desc: true }]);
    expect(state.columnFilters).toEqual([
      { id: "actor", value: "u-1" },
      { id: "occurredAt", value: { from: "2026-11-01", to: undefined } },
    ]);
    expect(state.pagination).toEqual({ pageIndex: 0, pageSize: 25 });
    expect(activityTableState(parse({ dir: "asc" })).sorting).toEqual([
      { id: "occurredAt", desc: false },
    ]);
  });

  it("writes a new sort as the direction, leaving the default out, and starts at page 1", () => {
    const prev = parse({ page: 3 });
    expect(
      nextActivitySearch(prev, { sorting: [{ id: "occurredAt", desc: false }] }),
    ).toMatchObject({ dir: "asc", page: undefined });
    expect(nextActivitySearch(prev, { sorting: [{ id: "occurredAt", desc: true }] }).dir).toBe(
      undefined,
    );
  });

  it("writes the filters and the period, validated, and starts at page 1", () => {
    const next = nextActivitySearch(parse({ page: 4, dir: "asc" }), {
      columnFilters: [
        { id: "target", value: "u-2" },
        { id: "action", value: ["user_banned", "nonsense"] },
        { id: "occurredAt", value: { from: "2026-11-09", to: "2026-11-02" } },
      ],
    });
    expect(next).toMatchObject({
      target: "u-2",
      action: ["user_banned"],
      from: "2026-11-02",
      to: "2026-11-09",
      dir: "asc",
      page: undefined,
    });
    expect(hasActivityFilters(next)).toBe(true);
    const cleared = nextActivitySearch(next, { columnFilters: [] });
    expect(hasActivityFilters(cleared)).toBe(false);
  });

  it("writes the page, and a new page size starts at page 1", () => {
    const prev = parse({});
    expect(nextActivitySearch(prev, { pagination: { pageIndex: 2, pageSize: 25 } })).toMatchObject({
      page: 3,
      size: undefined,
    });
    expect(nextActivitySearch(prev, { pagination: { pageIndex: 2, pageSize: 50 } })).toMatchObject({
      page: undefined,
      size: 50,
    });
  });

  it("reads a period only from an object with a day", () => {
    expect(periodOf(undefined)).toBeUndefined();
    expect(periodOf("2026-11-01")).toBeUndefined();
    expect(periodOf({ from: 1 })).toBeUndefined();
    expect(periodOf({ to: "2026-11-01" })).toEqual({ from: undefined, to: "2026-11-01" });
  });

  it("builds the server input without empty keys", () => {
    expect(listInputFromSearch(parse({}))).toEqual({});
    expect(
      listInputFromSearch(
        parse({
          actor: "a",
          target: "t",
          action: ["user_banned"],
          outcome: ["failure"],
          from: "2026-11-01",
          to: "2026-11-02",
          dir: "asc",
          page: 2,
          size: 50,
        }),
      ),
    ).toEqual({
      actor: "a",
      target: "t",
      action: ["user_banned"],
      outcome: ["failure"],
      from: "2026-11-01",
      to: "2026-11-02",
      dir: "asc",
      page: 2,
      size: 50,
    });
  });
});
