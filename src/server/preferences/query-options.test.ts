// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The preferences' Query layer (#62): saving the landing portal is optimistic in the session
// entry and rolls back on a server error; saving the language touches no cached key.
import type { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sessionKeys, sessionQueryOptions } from "../../lib/session.query-options.ts";
import {
  invalidatedKeys,
  runMutation,
  seedCache,
  testQueryClient,
} from "../../lib/test-query-client.ts";
import { usersKeys } from "../users/query-options.ts";
import {
  preferencesKeys,
  saveLastPortalMutationOptions,
  saveLocaleMutationOptions,
} from "./query-options.ts";

vi.mock("../../lib/session.functions.ts", () => ({ getSession: vi.fn() }));
vi.mock("../users/functions.ts", () => ({ listAdminUsers: vi.fn(), getAdminUser: vi.fn() }));

const USER = {
  id: "user-one",
  name: "Test Teacher",
  email: "teacher@example.test",
  roles: ["teacher", "admin"] as const,
  lastPortal: "teacher" as const,
};

let queryClient: QueryClient;
beforeEach(() => {
  queryClient = testQueryClient();
  seedCache(queryClient, [
    [sessionKeys.current(), USER],
    [usersKeys.list({}), { rows: [] }],
    [usersKeys.detail(USER.id), { id: USER.id }],
  ]);
});

describe("sessionQueryOptions", () => {
  it("keys the session under its own root and is always stale (role changes apply at once)", () => {
    const options = sessionQueryOptions();
    expect(options.queryKey).toEqual(["session", "current"]);
    expect(options.staleTime).toBe(0);
  });
});

describe("saveLastPortalMutationOptions", () => {
  it("invalidates the session entry and nothing else", async () => {
    const call = vi.fn().mockResolvedValue({ portal: "admin" });
    await runMutation(queryClient, saveLastPortalMutationOptions(queryClient, call), "admin");
    expect(call).toHaveBeenCalledWith({ data: { portal: "admin" } });
    expect(invalidatedKeys(queryClient)).toEqual([JSON.stringify(sessionKeys.current())]);
  });

  it("writes the new portal into the cached session before the server answers", async () => {
    let answer: (value: { portal: "admin" }) => void = () => undefined;
    const call = () =>
      new Promise<{ portal: "admin" }>((resolve) => {
        answer = resolve;
      });
    const running = runMutation(
      queryClient,
      saveLastPortalMutationOptions(queryClient, call),
      "admin",
    );
    await vi.waitFor(() =>
      expect(queryClient.getQueryData(sessionKeys.current())).toMatchObject({
        lastPortal: "admin",
      }),
    );
    answer({ portal: "admin" });
    expect((await running).data).toBe("admin");
  });

  it("rolls the cached portal back when the server fails (500)", async () => {
    const call = vi.fn().mockRejectedValue(new Error("500"));
    const { error } = await runMutation(
      queryClient,
      saveLastPortalMutationOptions(queryClient, call),
      "admin",
    );
    expect(error?.message).toBe("500");
    expect(queryClient.getQueryData(sessionKeys.current())).toEqual(USER);
    expect(invalidatedKeys(queryClient)).toEqual([JSON.stringify(sessionKeys.current())]);
  });

  it("writes nothing when there is no cached session user", async () => {
    queryClient.setQueryData(sessionKeys.current(), null);
    const call = vi.fn().mockResolvedValue({ portal: "admin" });
    await runMutation(queryClient, saveLastPortalMutationOptions(queryClient, call), "admin");
    expect(queryClient.getQueryData(sessionKeys.current())).toBeNull();
  });

  it("carries its own mutation key", () => {
    const options = saveLastPortalMutationOptions(queryClient, vi.fn());
    expect(options.mutationKey).toEqual(preferencesKeys.lastPortal());
  });
});

describe("saveLocaleMutationOptions", () => {
  it("saves a signed-in user's language and invalidates no key (the page reloads)", async () => {
    const call = vi.fn().mockResolvedValue({ locale: "nl" });
    const { data } = await runMutation(queryClient, saveLocaleMutationOptions(call, true), "nl");
    expect(data).toBe("nl");
    expect(call).toHaveBeenCalledWith({ data: { locale: "nl" } });
    expect(invalidatedKeys(queryClient)).toEqual([]);
  });

  it("saves nothing for a visitor without a session", async () => {
    const call = vi.fn();
    const { data } = await runMutation(queryClient, saveLocaleMutationOptions(call, false), "nl");
    expect(data).toBe("nl");
    expect(call).not.toHaveBeenCalled();
  });

  it("fails on a server error, so the menu falls back to the active language", async () => {
    const call = vi.fn().mockRejectedValue(new Error("500"));
    const { error } = await runMutation(queryClient, saveLocaleMutationOptions(call, true), "nl");
    expect(error?.message).toBe("500");
    expect(queryClient.getQueryData(sessionKeys.current())).toEqual(USER);
    expect(invalidatedKeys(queryClient)).toEqual([]);
  });
});
