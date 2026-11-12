// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The activity log's Query layer (#36): keys from one factory, the domain's stale times, and a
// user search that only runs with text.
import { describe, expect, it, vi } from "vitest";
import { STALE_TIME } from "../../lib/query-config.ts";
import { testQueryClient } from "../../lib/test-query-client.ts";
import { listAdminActivity, searchAdminActivityUsers } from "./functions.ts";
import {
  activityKeys,
  activityUserSearchQueryOptions,
  adminActivityQueryOptions,
} from "./query-options.ts";

vi.mock("./functions.ts", () => ({
  listAdminActivity: vi.fn(async () => ({ rows: [] })),
  searchAdminActivityUsers: vi.fn(async () => []),
}));

describe("the activity log query options (#36)", () => {
  it("keys every list under lists() and every search under userSearches()", () => {
    expect(activityKeys.list({ actor: "u-1" })).toEqual([
      "admin-activity",
      "list",
      { actor: "u-1" },
    ]);
    expect(activityKeys.userSearch("an")).toEqual(["admin-activity", "user-search", "an"]);
  });

  it("reads a page through the server function with the list's stale time", async () => {
    const options = adminActivityQueryOptions({ page: 2 });
    expect(options.staleTime).toBe(STALE_TIME.adminActivityList);
    expect(options.queryKey).toEqual(activityKeys.list({ page: 2 }));
    await testQueryClient().fetchQuery(options);
    expect(listAdminActivity).toHaveBeenCalledWith({ data: { page: 2 } });
  });

  it("searches users with trimmed text, and not at all without text", async () => {
    expect(activityUserSearchQueryOptions("   ").enabled).toBe(false);
    const options = activityUserSearchQueryOptions(" an ");
    expect(options.enabled).toBe(true);
    expect(options.queryKey).toEqual(activityKeys.userSearch("an"));
    await testQueryClient().fetchQuery(options);
    expect(searchAdminActivityUsers).toHaveBeenCalledWith({ data: { q: "an" } });
  });
});
