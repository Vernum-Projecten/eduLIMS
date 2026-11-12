// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  adminClassFormSchema,
  adminClassListSearchSchema,
  listAdminClassesInput,
  transferFormSchema,
} from "./admin-schemas.ts";
import {
  adminClassesInputFromSearch,
  adminClassesTableState,
  hasAdminClassFilters,
  nextAdminClassesSearch,
  onlyClassSearchTextChanged,
} from "./admin-table-state.ts";

const OWNER = "01960000-0000-7000-8000-000000000001";

describe("adminClassListSearchSchema (#37)", () => {
  it("keeps known values and drops the rest, so an old or edited link still opens", () => {
    expect(
      adminClassListSearchSchema.parse({
        q: "  LS  ",
        status: ["archived", "deleted", "archived"],
        year: ["2026-2027", "2026-2028", "next"],
        owner: OWNER,
        page: "2",
        size: "13",
      }),
    ).toEqual({
      q: "LS",
      status: ["archived"],
      year: ["2026-2027"],
      owner: [OWNER],
      page: 2,
      size: undefined,
    });
  });

  it("reads an empty search and empty facets as no filter", () => {
    expect(adminClassListSearchSchema.parse({ q: " ", status: [] })).toEqual({
      q: undefined,
      status: undefined,
    });
  });
});

describe("listAdminClassesInput (#37)", () => {
  it("refuses unknown keys, statuses and academic years", () => {
    expect(listAdminClassesInput.safeParse({ role: ["admin"] }).success).toBe(false);
    expect(listAdminClassesInput.safeParse({ status: ["gone"] }).success).toBe(false);
    expect(listAdminClassesInput.safeParse({ year: ["2026-2028"] }).success).toBe(false);
    expect(listAdminClassesInput.safeParse({ size: 7 }).success).toBe(false);
    expect(listAdminClassesInput.safeParse({ owner: [OWNER], page: 3 }).success).toBe(true);
  });
});

describe("the administrator's forms (#37)", () => {
  it("requires an owner on the class form and the transfer form", () => {
    const form = adminClassFormSchema.safeParse({
      name: "LS-2A",
      academicYear: "2026-2027",
      ownerId: "",
    });
    expect(form.success).toBe(false);
    expect(transferFormSchema.safeParse({ userId: "" }).success).toBe(false);
    expect(transferFormSchema.safeParse({ userId: OWNER }).success).toBe(true);
  });
});

describe("the class table state in the URL (#37)", () => {
  it("maps the search params to filters and a zero-based page, Active by default", () => {
    expect(adminClassesTableState({ q: "LS", year: ["2026-2027"], page: 3 })).toEqual({
      columnFilters: [
        { id: "name", value: "LS" },
        { id: "status", value: ["active"] },
        { id: "year", value: ["2026-2027"] },
      ],
      pagination: { pageIndex: 2, pageSize: 25 },
    });
  });

  it("starts a new filter on the first page", () => {
    const next = nextAdminClassesSearch(
      { page: 4 },
      { columnFilters: [{ id: "status", value: ["archived"] }] },
    );
    expect(next).toEqual({
      page: undefined,
      q: undefined,
      status: ["archived"],
      year: undefined,
      owner: undefined,
    });
  });

  it("keeps the page on a page change and resets it on a new page size", () => {
    expect(
      nextAdminClassesSearch({ q: "LS" }, { pagination: { pageIndex: 1, pageSize: 25 } }),
    ).toEqual({ q: "LS", page: 2, size: undefined });
    expect(
      nextAdminClassesSearch({ page: 3 }, { pagination: { pageIndex: 2, pageSize: 50 } }),
    ).toEqual({ page: undefined, size: 50 });
  });

  it("replaces the history entry only while the search text alone changes", () => {
    expect(onlyClassSearchTextChanged({ q: "L" }, { q: "LS" })).toBe(true);
    expect(onlyClassSearchTextChanged({ q: "L" }, { q: "LS", status: ["active"] })).toBe(false);
    expect(onlyClassSearchTextChanged({ q: "L" }, { q: "L" })).toBe(false);
  });

  it("leaves the default status out of the URL and keeps any other choice", () => {
    const active = { columnFilters: [{ id: "status", value: ["active"] }] };
    expect(nextAdminClassesSearch({ status: ["archived"] }, active).status).toBeUndefined();
    const none = { columnFilters: [] };
    expect(nextAdminClassesSearch({ status: ["archived"] }, none).status).toBeUndefined();
    const both = { columnFilters: [{ id: "status", value: ["active", "archived"] }] };
    expect(nextAdminClassesSearch({}, both).status).toEqual(["active", "archived"]);
  });

  it("keeps the owner-not-teacher filter in the URL and the server input (#37)", () => {
    expect(adminClassListSearchSchema.parse({ ownerNotTeacher: "true" }).ownerNotTeacher).toBe(
      true,
    );
    expect(
      adminClassListSearchSchema.parse({ ownerNotTeacher: "no" }).ownerNotTeacher,
    ).toBeUndefined();
    const on = { columnFilters: [{ id: "ownerNotTeacher", value: true }] };
    expect(nextAdminClassesSearch({ page: 2 }, on).ownerNotTeacher).toBe(true);
    expect(hasAdminClassFilters({ ownerNotTeacher: true })).toBe(true);
    expect(adminClassesInputFromSearch({ ownerNotTeacher: true })).toEqual({
      status: ["active"],
      ownerNotTeacher: true,
    });
    expect(listAdminClassesInput.safeParse({ ownerNotTeacher: false }).success).toBe(false);
  });

  it("tells a filtered list from the default list", () => {
    expect(hasAdminClassFilters({ page: 2 })).toBe(false);
    expect(hasAdminClassFilters({ status: ["active"] })).toBe(false);
    expect(hasAdminClassFilters({ status: ["archived"] })).toBe(true);
    expect(hasAdminClassFilters({ owner: [OWNER] })).toBe(true);
  });

  it("builds the server input without empty keys, Active when no status is chosen", () => {
    expect(adminClassesInputFromSearch({ q: undefined, size: 50 })).toEqual({
      status: ["active"],
      size: 50,
    });
    expect(
      adminClassesInputFromSearch({
        q: "LS",
        year: ["2026-2027"],
        owner: [OWNER],
        page: 2,
      }),
    ).toEqual({ q: "LS", status: ["active"], year: ["2026-2027"], owner: [OWNER], page: 2 });
  });
});
