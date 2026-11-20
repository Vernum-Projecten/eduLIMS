// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The TanStack Query layer of simulations and labs (D10, S10, B5): one key factory, the query
// options of each read, and mutation options whose invalidation keys every caller names
// explicitly. A lab's keys nest under its simulation, so a write to a simulation reaches its labs.
import {
  keepPreviousData,
  mutationOptions,
  type QueryClient,
  type QueryKey,
  queryOptions,
} from "@tanstack/react-query";
import { STALE_TIME } from "../../lib/query-config.ts";
import type { SimulationActionError, SimulationResult } from "./access.ts";
import type { ListAdminSimulationsInput } from "./admin-schemas.ts";
import {
  getAdminSimulationFn,
  getJoinCodeFn,
  getLabPage,
  getMyLab,
  getSimulationPage,
  listAdminSimulationsFn,
  listMySimulations,
} from "./functions.ts";
import type { LabLogoInfo, LogoResult } from "./logo.ts";

/** The query keys of simulations, from the widest to the narrowest. */
export const simulationsKeys = {
  all: ["simulations"] as const,
  lists: () => [...simulationsKeys.all, "list"] as const,
  details: () => [...simulationsKeys.all, "detail"] as const,
  detail: (simulationId: string) => [...simulationsKeys.details(), simulationId] as const,
  lab: (simulationId: string, labId: string) =>
    [...simulationsKeys.detail(simulationId), "lab", labId] as const,
  joinCode: (simulationId: string, labId: string) =>
    [...simulationsKeys.lab(simulationId, labId), "join-code"] as const,
  /** The correct values and limits of a simulation, teacher-scoped (D10, D13). */
  correctValues: (simulationId: string) =>
    [...simulationsKeys.detail(simulationId), "correct-values"] as const,
  student: () => [...simulationsKeys.all, "student"] as const,
  admin: () => [...simulationsKeys.all, "admin"] as const,
  adminList: () => [...simulationsKeys.admin(), "list"] as const,
  adminPage: (input: ListAdminSimulationsInput) => [...simulationsKeys.adminList(), input] as const,
  adminDetail: (simulationId: string) =>
    [...simulationsKeys.admin(), "detail", simulationId] as const,
};

/**
 * What each kind of write invalidates. A write inside a simulation changes its page, its labs'
 * pages (nested under it), the teacher's list (its counts) and the administrator's view (B5).
 */
export const simulationInvalidation = {
  /** Creating a simulation: only the lists know it yet. */
  created: (): QueryKey[] => [simulationsKeys.lists(), simulationsKeys.admin()],
  /** Any write inside one simulation: renaming it, its teachers, labs and members. */
  simulation: (simulationId: string): QueryKey[] => [
    simulationsKeys.detail(simulationId),
    simulationsKeys.lists(),
    simulationsKeys.admin(),
  ],
  /** A change to a lab's waiting addresses: its page and the simulation page's counts. */
  waiting: (simulationId: string): QueryKey[] => [simulationsKeys.detail(simulationId)],
  /** A lab's logo: its page and the simulation page's labs; no count or admin column changes. */
  logo: (simulationId: string): QueryKey[] => [simulationsKeys.detail(simulationId)],
  /** Turning a lab's join code on, replacing it or turning it off: its state only (#288). */
  joinCode: (simulationId: string, labId: string): QueryKey[] => [
    simulationsKeys.joinCode(simulationId, labId),
  ],
  /** Linking the student's waiting addresses, or joining with a code: their own labs. */
  student: (): QueryKey[] => [simulationsKeys.student()],
};

/** The teacher's simulations. */
export function mySimulationsQueryOptions() {
  return queryOptions({
    queryKey: simulationsKeys.lists(),
    queryFn: () => listMySimulations(),
    staleTime: STALE_TIME.simulations,
  });
}

/** The teacher's page of one simulation. */
export function simulationPageQueryOptions(simulationId: string) {
  return queryOptions({
    queryKey: simulationsKeys.detail(simulationId),
    queryFn: () => getSimulationPage({ data: { simulationId } }),
    staleTime: STALE_TIME.simulations,
  });
}

/** The teacher's page of one lab, keyed under its simulation. */
export function labPageQueryOptions(simulationId: string, labId: string) {
  return queryOptions({
    queryKey: simulationsKeys.lab(simulationId, labId),
    queryFn: () => getLabPage({ data: { labId } }),
    staleTime: STALE_TIME.simulations,
  });
}

/** The state of a lab's join code, keyed under the lab; never the code itself (#288). */
export function joinCodeQueryOptions(simulationId: string, labId: string) {
  return queryOptions({
    queryKey: simulationsKeys.joinCode(simulationId, labId),
    queryFn: () => getJoinCodeFn({ data: { labId } }),
    staleTime: STALE_TIME.simulations,
  });
}

/** The student's current lab, or `null`; the server picks it (S10, #379). */
export function myLabQueryOptions() {
  return queryOptions({
    queryKey: simulationsKeys.student(),
    queryFn: () => getMyLab(),
    staleTime: STALE_TIME.simulations,
  });
}

/**
 * One page of the administrator's read-only list (B5, #291), keyed by the search and the page.
 * While the next page or search loads, the previous page stays on screen; a failure with no
 * page to show throws to the route's error state.
 */
export function adminSimulationsQueryOptions(input: ListAdminSimulationsInput) {
  return queryOptions({
    queryKey: simulationsKeys.adminPage(input),
    queryFn: () => listAdminSimulationsFn({ data: input }),
    staleTime: STALE_TIME.simulations,
    placeholderData: keepPreviousData,
    throwOnError: (_error, query) => query.state.data === undefined,
  });
}

/** The page of simulations {@link adminSimulationsQueryOptions} returns. */
export type AdminSimulationsPage = Awaited<ReturnType<typeof listAdminSimulationsFn>>;

/** The administrator's read-only view of one simulation (B5). */
export function adminSimulationQueryOptions(simulationId: string) {
  return queryOptions({
    queryKey: simulationsKeys.adminDetail(simulationId),
    queryFn: () => getAdminSimulationFn({ data: { simulationId } }),
    staleTime: STALE_TIME.simulations,
  });
}

/** An action the server refused: the code maps to a translated message at the edge. */
export class SimulationActionRefused extends Error {
  readonly code: SimulationActionError;
  /** The tests a `missing_limits` refusal names; empty for every other refusal. */
  readonly testIds: readonly string[];

  constructor(code: SimulationActionError, testIds: readonly string[] = []) {
    super(code);
    this.name = "SimulationActionRefused";
    this.code = code;
    this.testIds = testIds;
  }
}

/** Returns the refusal code of a failed action; anything but a refusal is `null`. */
export function simulationErrorCode(error: unknown): SimulationActionError | null {
  return error instanceof SimulationActionRefused ? error.code : null;
}

/** Returns the tests a refusal names (`missing_limits`); empty for anything else. */
export function refusedTestIds(error: unknown): readonly string[] {
  return error instanceof SimulationActionRefused ? error.testIds : [];
}

/** A server function of one action, as `useServerFn` returns it. */
export type SimulationCall<TInput, TValue> = (options: {
  data: TInput;
}) => Promise<SimulationResult<TValue>>;

/**
 * The mutation options of one action: the call throws its refusal, so the caller's `onError`
 * shows it, and the keys `invalidates` names are invalidated once it settles, refused or not.
 * Pass `[]` for a read-only action such as the preview of a list.
 */
export function simulationMutationOptions<TInput, TValue>(
  queryClient: QueryClient,
  call: SimulationCall<TInput, TValue>,
  invalidates: readonly QueryKey[],
) {
  return mutationOptions({
    mutationFn: async (data: TInput): Promise<TValue> => {
      const result = await call({ data });
      if (!result.ok) throw new SimulationActionRefused(result.error, result.testIds);
      return result.value;
    },
    onSettled: () =>
      Promise.all(invalidates.map((queryKey) => queryClient.invalidateQueries({ queryKey }))),
  });
}

/**
 * The mutation options of a lab logo upload (#293). The outcome comes back as a value, not a
 * throw, because a refusal about the file shows at the form's file field: the caller reads it.
 * The keys `invalidates` names are invalidated once a logo is stored.
 */
export function labLogoUploadMutationOptions(
  queryClient: QueryClient,
  call: (options: { data: FormData }) => Promise<LogoResult<LabLogoInfo>>,
  invalidates: readonly QueryKey[],
) {
  return mutationOptions({
    mutationFn: (data: FormData) => call({ data }),
    onSuccess: async (result) => {
      if (!result.ok) return;
      await Promise.all(invalidates.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    },
  });
}

/**
 * The mutation options of deleting a simulation or a lab: `leave` moves off its page first, then
 * the removed entry is dropped (a refetch would only answer 404) and `invalidates` is invalidated.
 */
export function deleteMutationOptions<TInput>(
  queryClient: QueryClient,
  call: SimulationCall<TInput, null>,
  removed: QueryKey,
  invalidates: readonly QueryKey[],
  leave: () => Promise<void>,
) {
  return mutationOptions({
    mutationFn: async (data: TInput): Promise<null> => {
      const result = await call({ data });
      if (!result.ok) throw new SimulationActionRefused(result.error, result.testIds);
      return null;
    },
    onSuccess: async () => {
      await leave();
      queryClient.removeQueries({ queryKey: removed });
      await Promise.all(invalidates.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    },
  });
}

/**
 * The mutation options of linking the student's waiting addresses (S10): the student's lab is
 * invalidated once it settles.
 */
export function linkMyLabsMutationOptions<TValue>(
  queryClient: QueryClient,
  call: () => Promise<TValue>,
) {
  return mutationOptions({
    mutationFn: () => call(),
    onSettled: () =>
      Promise.all(
        simulationInvalidation
          .student()
          .map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      ),
  });
}
