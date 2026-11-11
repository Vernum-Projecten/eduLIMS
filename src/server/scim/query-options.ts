// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The TanStack Query layer of a provider's SCIM section (#45), after the Users screen's
// conventions (#58). The token a create or rotate returns is never cached: the mutation hands
// it to the component once, and only the token's dates live in the cache.
import { mutationOptions, type QueryClient, queryOptions } from "@tanstack/react-query";
import { STALE_TIME } from "../../lib/query-config.ts";
import { idpKeys } from "../idp/query-options.ts";
import { getScimDetail } from "./functions.ts";
import type { ExternalIdClaim } from "./schemas.ts";
import type { ScimSettingResult } from "./settings.ts";
import type { ScimTokenError, ScimTokenIssued, ScimTokenRevoked } from "./tokens.ts";

/** The query keys of the SCIM section, under the provider's own keys. */
export const scimKeys = {
  all: [...idpKeys.all, "scim"] as const,
  detail: (providerId: string) => [...scimKeys.all, providerId] as const,
};

/** One provider's SCIM section. */
export function scimDetailQueryOptions(providerId: string) {
  return queryOptions({
    queryKey: scimKeys.detail(providerId),
    queryFn: () => getScimDetail({ data: { providerId } }),
    staleTime: STALE_TIME.scimDetail,
  });
}

/** Why a SCIM change was refused, as the screen maps it to a message. */
export type ScimChangeError = ScimTokenError | "invalid" | "failed";

/** A SCIM change the server refused. */
export class ScimChangeRefused extends Error {
  readonly code: ScimChangeError;

  constructor(code: ScimChangeError) {
    super(code);
    this.name = "ScimChangeRefused";
    this.code = code;
  }
}

/** Returns the refusal code of a failed change; anything but a refusal is `failed`. */
export function scimErrorCode(error: unknown): ScimChangeError {
  return error instanceof ScimChangeRefused ? error.code : "failed";
}

type Call<TResult> = (options: { data: { providerId: string } }) => Promise<TResult>;

/** A token just issued: shown once, with when it and the token it replaced stop working. */
export interface IssuedScimToken {
  token: string;
  expiresAt: string;
  previousValidUntil: string | null;
}

/** Creates or rotates a token; resolves to the plaintext token, which nothing caches. */
export function issueScimTokenMutationOptions(
  queryClient: QueryClient,
  call: Call<ScimTokenIssued>,
) {
  return mutationOptions({
    // NOTE: #45 (L1); the mutation's result holds the plaintext token, so the cache drops it
    // the moment no component watches it.
    gcTime: 0,
    mutationFn: async (data: { providerId: string }): Promise<IssuedScimToken> => {
      const result = await call({ data });
      if (!result.ok) throw new ScimChangeRefused(result.error);
      const { token, expiresAt, previousValidUntil } = result;
      return { token, expiresAt, previousValidUntil };
    },
    onSettled: (_token, _error, data) =>
      queryClient.invalidateQueries({ queryKey: scimKeys.detail(data.providerId) }),
  });
}

/** Revokes a token. */
export function revokeScimTokenMutationOptions(
  queryClient: QueryClient,
  call: Call<ScimTokenRevoked>,
) {
  return mutationOptions({
    mutationFn: async (data: { providerId: string }) => {
      const result = await call({ data });
      if (!result.ok) throw new ScimChangeRefused(result.error);
      return result.providerId;
    },
    onSettled: (_id, _error, data) =>
      queryClient.invalidateQueries({ queryKey: scimKeys.detail(data.providerId) }),
  });
}

/** Sets the external-id claim. */
export function setExternalIdClaimMutationOptions(
  queryClient: QueryClient,
  call: (options: {
    data: { providerId: string; claim: ExternalIdClaim };
  }) => Promise<ScimSettingResult>,
) {
  return mutationOptions({
    mutationFn: async (data: { providerId: string; claim: ExternalIdClaim }) => {
      const result = await call({ data });
      if (!result.ok)
        throw new ScimChangeRefused(result.error === "not_found" ? "not_found" : "invalid");
      return result.providerId;
    },
    onSettled: (_id, _error, data) =>
      queryClient.invalidateQueries({ queryKey: scimKeys.detail(data.providerId) }),
  });
}
