// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  analyserFormSchema,
  analyserListSearchSchema,
  createAnalyserInput,
  listAnalysersInput,
  updateAnalyserInput,
} from "./schemas.ts";
import {
  analyserListInput,
  analysersTableState,
  hasAnalyserFilters,
  nextAnalysersSearch,
  onlyAnalyserSearchChanged,
} from "./table-state.ts";

const FORM = {
  model: "BioTek Epoch 2",
  serialNumber: "EP2-TEST-0001",
  location: "Lab A",
  route: "excel_upload",
  status: "in_use",
  notes: "",
} as const;

function messages(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) {
  return result.error?.issues.map((issue) => issue.path.join(".")) ?? [];
}

describe("analyserFormSchema (B3)", () => {
  it("accepts a complete form and trims the text fields", () => {
    const parsed = analyserFormSchema.parse({ ...FORM, model: "  BioTek Epoch 2  " });
    expect(parsed.model).toBe("BioTek Epoch 2");
  });

  it("refuses empty required fields, each at its own field", () => {
    const result = analyserFormSchema.safeParse({
      ...FORM,
      model: " ",
      serialNumber: "",
      location: "",
      route: "",
    });
    expect(messages(result)).toEqual(["model", "serialNumber", "location", "route"]);
  });

  it("refuses a retired status: retiring is its own confirmed action", () => {
    expect(analyserFormSchema.safeParse({ ...FORM, status: "retired" }).success).toBe(false);
  });

  it("refuses text longer than the database allows", () => {
    expect(analyserFormSchema.safeParse({ ...FORM, serialNumber: "x".repeat(65) }).success).toBe(
      false,
    );
    expect(analyserFormSchema.safeParse({ ...FORM, notes: "x".repeat(1001) }).success).toBe(false);
  });

  it("refuses unknown keys at the server function and a malformed id", () => {
    expect(createAnalyserInput.safeParse({ ...FORM, retiredAt: "now" }).success).toBe(false);
    expect(updateAnalyserInput.safeParse({ ...FORM, analyserId: "1 or 1=1" }).success).toBe(false);
  });
});

describe("the register's URL state", () => {
  it("drops unknown filter values and keeps known ones", () => {
    expect(
      analyserListSearchSchema.parse({ status: ["retired", "lost"], route: "excel_upload" }),
    ).toMatchObject({ status: ["retired"], route: ["excel_upload"] });
  });

  it("falls back on a bad sort or page size instead of failing", () => {
    expect(analyserListSearchSchema.parse({ sort: "password", size: "7" })).toEqual({});
  });

  it("refuses an unknown key or value at the server function", () => {
    expect(listAnalysersInput.safeParse({ status: ["lost"] }).success).toBe(false);
    expect(listAnalysersInput.safeParse({ url: "http://example.test" }).success).toBe(false);
  });

  it("maps the URL to the table and back, starting a new filter on page 1", () => {
    const search = analyserListSearchSchema.parse({ q: "Lab", page: "3", sort: "location" });
    expect(analysersTableState(search)).toMatchObject({
      sorting: [{ id: "location", desc: false }],
      columnFilters: [{ id: "model", value: "Lab" }],
      pagination: { pageIndex: 2, pageSize: 25 },
    });
    const next = nextAnalysersSearch(search, {
      columnFilters: [
        { id: "model", value: "Lab" },
        { id: "status", value: ["maintenance"] },
      ],
    });
    expect(next).toMatchObject({ status: ["maintenance"], page: undefined });
    expect(hasAnalyserFilters(next)).toBe(true);
    expect(hasAnalyserFilters({})).toBe(false);
  });

  it("leaves the default sort and page size out of the URL", () => {
    const sorted = nextAnalysersSearch(
      { sort: "location" },
      { sorting: [{ id: "model", desc: false }] },
    );
    expect(sorted.sort).toBeUndefined();
    const paged = nextAnalysersSearch({}, { pagination: { pageIndex: 1, pageSize: 25 } });
    expect(paged).toMatchObject({ page: 2, size: undefined });
    const resized = nextAnalysersSearch(
      { page: 2 },
      { pagination: { pageIndex: 1, pageSize: 50 } },
    );
    expect(resized).toMatchObject({ page: undefined, size: 50 });
  });

  it("replaces the history entry only while the search text alone changes", () => {
    expect(onlyAnalyserSearchChanged({ q: "a" }, { q: "ab" })).toBe(true);
    expect(onlyAnalyserSearchChanged({ q: "a" }, { q: "ab", status: ["retired"] })).toBe(false);
  });

  it("builds the server function input without empty keys", () => {
    expect(analyserListInput({})).toEqual({});
    expect(
      analyserListInput({
        q: "x",
        status: ["in_use"],
        route: ["excel_upload"],
        sort: "model",
        dir: "desc",
        page: 2,
        size: 50,
      }),
    ).toEqual({
      q: "x",
      status: ["in_use"],
      route: ["excel_upload"],
      sort: "model",
      dir: "desc",
      page: 2,
      size: 50,
    });
  });
});
