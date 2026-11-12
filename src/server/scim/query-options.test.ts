// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The SCIM section's Query layer (#45): every mutation invalidates only its provider's SCIM
// key, never the provider list, and a refusal fails the mutation with its code.
import type { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  invalidatedKeys,
  runMutation,
  seedCache,
  testQueryClient,
} from "../../lib/test-query-client.ts";
import { idpKeys } from "../idp/query-options.ts";
import {
  issueScimTokenMutationOptions,
  revokeScimTokenMutationOptions,
  ScimChangeRefused,
  scimErrorCode,
  scimKeys,
  setExternalIdClaimMutationOptions,
} from "./query-options.ts";

vi.mock("./functions.ts", () => ({ getScimDetail: vi.fn() }));
vi.mock("../idp/functions.ts", () => ({}));

let queryClient: QueryClient;
const CAMPUS = scimKeys.detail("campus");

beforeEach(() => {
  queryClient = testQueryClient();
  seedCache(queryClient, [
    [CAMPUS, { active: false }],
    [scimKeys.detail("other"), { active: false }],
    [idpKeys.lists(), []],
    [idpKeys.detail("campus"), {}],
  ]);
});

describe("scimKeys", () => {
  it("sits under the identity-provider root", () => {
    expect(CAMPUS).toEqual(["identity-providers", "scim", "campus"]);
  });
});

describe("targeted invalidation", () => {
  it("issuing a token returns it and invalidates only that provider's SCIM section", async () => {
    const options = issueScimTokenMutationOptions(queryClient, async () => ({
      ok: true,
      providerId: "campus",
      token: "edulims_scim_t",
      expiresAt: "2027-05-11T00:00:00.000Z",
      previousValidUntil: null,
    }));
    const { data } = await runMutation(queryClient, options, { providerId: "campus" });
    expect(data).toEqual({
      token: "edulims_scim_t",
      expiresAt: "2027-05-11T00:00:00.000Z",
      previousValidUntil: null,
    });
    expect(invalidatedKeys(queryClient)).toEqual([JSON.stringify(CAMPUS)]);
    expect(queryClient.getQueryData(CAMPUS)).not.toHaveProperty("token");
  });

  it("revoking invalidates only that provider's SCIM section", async () => {
    const options = revokeScimTokenMutationOptions(queryClient, async () => ({
      ok: true,
      providerId: "campus",
    }));
    await runMutation(queryClient, options, { providerId: "campus" });
    expect(invalidatedKeys(queryClient)).toEqual([JSON.stringify(CAMPUS)]);
  });

  it("setting the claim invalidates only that provider's SCIM section", async () => {
    const options = setExternalIdClaimMutationOptions(queryClient, async () => ({
      ok: true,
      providerId: "campus",
    }));
    await runMutation(queryClient, options, { providerId: "campus", claim: "oid" });
    expect(invalidatedKeys(queryClient)).toEqual([JSON.stringify(CAMPUS)]);
  });
});

describe("refusals", () => {
  it("fails a refused change with its code", async () => {
    const issue = issueScimTokenMutationOptions(queryClient, async () => ({
      ok: false,
      error: "exists",
    }));
    const { error } = await runMutation(queryClient, issue, { providerId: "campus" });
    expect(error).toBeInstanceOf(ScimChangeRefused);
    expect(scimErrorCode(error)).toBe("exists");
    const revoke = revokeScimTokenMutationOptions(queryClient, async () => ({
      ok: false,
      error: "no_token",
    }));
    expect(scimErrorCode((await runMutation(queryClient, revoke, { providerId: "c" })).error)).toBe(
      "no_token",
    );
    const claim = setExternalIdClaimMutationOptions(queryClient, async () => ({
      ok: false,
      error: "invalid",
    }));
    const result = await runMutation(queryClient, claim, { providerId: "c", claim: "oid" });
    expect(scimErrorCode(result.error)).toBe("invalid");
  });

  it("maps any other failure to failed", () => {
    expect(scimErrorCode(new Error("500"))).toBe("failed");
  });
});
