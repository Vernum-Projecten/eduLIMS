// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The TanStack Query layer of Admin → System → Identity providers (#46), after the Users
// screen's conventions (#58): one key factory, the query options of every read, and the
// mutation options of every write with targeted invalidation. Server data lives only in the
// Query cache; the components add the toasts.
import { mutationOptions, type QueryClient, queryOptions } from "@tanstack/react-query";
import {
  getIdentityProvider,
  getIdentityProviderTestResult,
  listIdentityProviderLabels,
  listIdentityProviders,
} from "./functions.ts";
import type { CreateProviderInput, UpdateProviderInput } from "./schemas.ts";
import type { IdpResult, IdpServiceError } from "./service.ts";

/** The query keys of the identity-provider screens, from the widest to the narrowest. */
export const idpKeys = {
  all: ["identity-providers"] as const,
  lists: () => [...idpKeys.all, "list"] as const,
  labels: () => [...idpKeys.all, "labels"] as const,
  details: () => [...idpKeys.all, "detail"] as const,
  detail: (providerId: string) => [...idpKeys.details(), providerId] as const,
  test: (providerId: string, test: string) => [...idpKeys.all, "test", providerId, test] as const,
};

/** The providers table. */
export function identityProvidersQueryOptions() {
  return queryOptions({ queryKey: idpKeys.lists(), queryFn: () => listIdentityProviders() });
}

/** Every provider id with its name in the active locale, for the Users screen. */
export function providerLabelsQueryOptions() {
  return queryOptions({
    queryKey: idpKeys.labels(),
    queryFn: () => listIdentityProviderLabels(),
  });
}

/** One provider's edit page. */
export function identityProviderQueryOptions(providerId: string) {
  return queryOptions({
    queryKey: idpKeys.detail(providerId),
    queryFn: () => getIdentityProvider({ data: { providerId } }),
  });
}

/** The outcome of one test sign-in; never cached, the page reloads it. */
export function identityProviderTestQueryOptions(providerId: string, test: string) {
  return queryOptions({
    queryKey: idpKeys.test(providerId, test),
    queryFn: () => getIdentityProviderTestResult({ data: { providerId, test } }),
    staleTime: 0,
  });
}

/** A provider change the server refused: the code maps to a translated message at the edge. */
export class IdpChangeRefused extends Error {
  readonly code: IdpServiceError;

  constructor(code: IdpServiceError) {
    super(code);
    this.name = "IdpChangeRefused";
    this.code = code;
  }
}

/** A server function of one provider change, as `useServerFn` returns it. */
export type IdpCall<TInput> = (options: { data: TInput }) => Promise<IdpResult>;

/** Calls a change and throws its refusal, so the mutation fails like a failed request. */
async function settled<TInput>(call: IdpCall<TInput>, data: TInput): Promise<string> {
  const result = await call({ data });
  if (!result.ok) throw new IdpChangeRefused(result.error);
  return result.providerId;
}

/** Invalidates what a change of `providerId` touched: its page, the list and the names. */
async function invalidateProvider(queryClient: QueryClient, providerId: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: idpKeys.detail(providerId) }),
    queryClient.invalidateQueries({ queryKey: idpKeys.lists() }),
    queryClient.invalidateQueries({ queryKey: idpKeys.labels() }),
  ]);
}

/** Adds a provider; the list and the names change. */
export function createProviderMutationOptions(
  queryClient: QueryClient,
  call: IdpCall<CreateProviderInput>,
) {
  return mutationOptions({
    mutationFn: (data: CreateProviderInput) => settled(call, data),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: idpKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: idpKeys.labels() }),
      ]),
  });
}

/** Edits a provider; its page, the list and the names change. */
export function updateProviderMutationOptions(
  queryClient: QueryClient,
  call: IdpCall<UpdateProviderInput>,
) {
  return mutationOptions({
    mutationFn: (data: UpdateProviderInput) => settled(call, data),
    onSettled: (_result, _error, data) => invalidateProvider(queryClient, data.providerId),
  });
}

/** Enables or disables a provider. */
export function setProviderEnabledMutationOptions(
  queryClient: QueryClient,
  call: IdpCall<{ providerId: string; enabled: boolean }>,
) {
  return mutationOptions({
    mutationFn: (data: { providerId: string; enabled: boolean }) => settled(call, data),
    onSettled: (_result, _error, data) => invalidateProvider(queryClient, data.providerId),
  });
}

/**
 * Deletes a provider. Its page is removed from the cache, not refetched: the caller leaves the
 * page first ({@link removeDeletedProvider}).
 */
export function deleteProviderMutationOptions(
  queryClient: QueryClient,
  call: IdpCall<{ providerId: string }>,
) {
  return mutationOptions({
    mutationFn: (data: { providerId: string }) => settled(call, data),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: idpKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: idpKeys.labels() }),
      ]),
  });
}

/** Drops a deleted provider's page from the cache, once nothing shows it. */
export function removeDeletedProvider(queryClient: QueryClient, providerId: string): void {
  queryClient.removeQueries({ queryKey: idpKeys.detail(providerId) });
}

/** Returns the refusal code of a failed change; anything but a refusal is `failed`. */
export function idpErrorCode(error: unknown): IdpServiceError | "failed" {
  return error instanceof IdpChangeRefused ? error.code : "failed";
}
