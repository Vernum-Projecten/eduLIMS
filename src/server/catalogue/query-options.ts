// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The TanStack Query layer of the test catalogue (D9, #266): one key factory, the list's query
// options and the mutation options of create, edit, retire and restore. Every change invalidates
// the keys `catalogueInvalidation` names: the list pages, the only entries the catalogue has.
import {
  keepPreviousData,
  mutationOptions,
  type QueryClient,
  type QueryKey,
  queryOptions,
} from "@tanstack/react-query";
import type { CatalogueTestId } from "../../lib/catalogue.ts";
import { STALE_TIME } from "../../lib/query-config.ts";
import type { TestActionError, TestActionResult } from "./actions.ts";
import { listCatalogueTests } from "./functions.ts";
import type { CreateTestInput, ListTestsInput, TestIdInput, UpdateTestInput } from "./schemas.ts";

/** The query keys of the catalogue, from the widest to the narrowest. */
export const catalogueKeys = {
  all: ["catalogue"] as const,
  lists: () => [...catalogueKeys.all, "list"] as const,
  list: (filters: ListTestsInput) => [...catalogueKeys.lists(), filters] as const,
};

/** What every change to the catalogue invalidates: each cached page of the list. */
export const catalogueInvalidation = {
  changed: (): QueryKey[] => [catalogueKeys.lists()],
};

/**
 * One page of the catalogue, keyed by the whole table state. While the next page or filter
 * loads, the previous page stays on screen (`keepPreviousData`). A failure with no page to show
 * throws to the route's error state; a failed background refetch keeps the page.
 */
export function catalogueTestsQueryOptions(input: ListTestsInput) {
  return queryOptions({
    queryKey: catalogueKeys.list(input),
    queryFn: () => listCatalogueTests({ data: input }),
    staleTime: STALE_TIME.catalogue,
    placeholderData: keepPreviousData,
    throwOnError: (_error, query) => query.state.data === undefined,
  });
}

/** The page of tests {@link catalogueTestsQueryOptions} returns. */
export type CatalogueTestsPage = Awaited<ReturnType<typeof listCatalogueTests>>;

/** What a failed change shows: a refusal of the server, or `failed` for anything else. */
export type CatalogueErrorCode = TestActionError | "failed";

/** A change the server refused: the code maps to a translated message at the edge. */
export class TestActionRefused extends Error {
  readonly code: TestActionError;

  constructor(code: TestActionError) {
    super(code);
    this.name = "TestActionRefused";
    this.code = code;
  }
}

/** Returns the refusal code of a failed change; anything but a refusal is `failed`. */
export function catalogueErrorCode(error: unknown): CatalogueErrorCode {
  return error instanceof TestActionRefused ? error.code : "failed";
}

/** A server function of one change, as `useServerFn` returns it. */
export type TestCall<TInput> = (options: { data: TInput }) => Promise<TestActionResult>;

/**
 * The mutation options of one change: the call throws its refusal, so a refused change fails
 * like a failed one, and the catalogue's keys are invalidated once it settles.
 */
function testMutationOptions<TInput>(queryClient: QueryClient, call: TestCall<TInput>) {
  return mutationOptions({
    mutationFn: async (data: TInput): Promise<CatalogueTestId> => {
      const result = await call({ data });
      if (!result.ok) throw new TestActionRefused(result.error);
      return result.testId;
    },
    onSettled: () =>
      Promise.all(
        catalogueInvalidation
          .changed()
          .map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      ),
  });
}

/** Adds a test; no optimistic row, since the server assigns its id and its place. */
export function createTestMutationOptions(
  queryClient: QueryClient,
  call: TestCall<CreateTestInput>,
) {
  return testMutationOptions(queryClient, call);
}

/** Changes a test. */
export function updateTestMutationOptions(
  queryClient: QueryClient,
  call: TestCall<UpdateTestInput>,
) {
  return testMutationOptions(queryClient, call);
}

/** Retires a test after its confirmation. */
export function retireTestMutationOptions(queryClient: QueryClient, call: TestCall<TestIdInput>) {
  return testMutationOptions(queryClient, call);
}

/** Restores a retired test. */
export function restoreTestMutationOptions(queryClient: QueryClient, call: TestCall<TestIdInput>) {
  return testMutationOptions(queryClient, call);
}
