// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The login page's Query layer (#84): one key from the factory, the read through the server
// function, the domain's staleTime, and a failed read that fails instead of offering nothing.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loginKeys, loginOptionsQueryOptions } from "./login.query-options.ts";
import { STALE_TIME } from "./query-config.ts";
import { getLoginOptions } from "./session.functions.ts";
import { testQueryClient } from "./test-query-client.ts";

vi.mock("./session.functions.ts", () => ({ getLoginOptions: vi.fn() }));

const OPTIONS = {
  providers: [],
  emailRouting: false,
  devLogin: true,
  demoAccounts: null,
  lastSignInMethod: null,
};

beforeEach(() => {
  vi.mocked(getLoginOptions).mockReset();
});

describe("loginOptionsQueryOptions", () => {
  it("keys the options under the login root", () => {
    expect(loginOptionsQueryOptions().queryKey).toEqual(["login", "options"]);
    expect(loginKeys.options().slice(0, loginKeys.all.length)).toEqual([...loginKeys.all]);
  });

  it("uses the login options staleTime", () => {
    expect(loginOptionsQueryOptions().staleTime).toBe(STALE_TIME.loginOptions);
  });

  it("loads the options through the server function into the cache", async () => {
    vi.mocked(getLoginOptions).mockResolvedValueOnce(OPTIONS);
    const queryClient = testQueryClient();
    await expect(queryClient.ensureQueryData(loginOptionsQueryOptions())).resolves.toEqual(OPTIONS);
    expect(queryClient.getQueryData(loginKeys.options())).toEqual(OPTIONS);
    expect(getLoginOptions).toHaveBeenCalledOnce();
  });

  it("rejects when the server function fails, and caches nothing", async () => {
    vi.mocked(getLoginOptions).mockRejectedValueOnce(new Error("server down"));
    const queryClient = testQueryClient();
    await expect(queryClient.ensureQueryData(loginOptionsQueryOptions())).rejects.toThrow(
      "server down",
    );
    expect(queryClient.getQueryData(loginKeys.options())).toBeUndefined();
  });
});
