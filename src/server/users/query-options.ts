// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The TanStack Query layer of the Users screen (#34, #58): one key factory, the query options
// of the list and the detail, and the mutation options of every action. Server data lives only
// in the Query cache; an optimistic update writes there and rolls back on failure.
import {
  keepPreviousData,
  mutationOptions,
  type QueryClient,
  type QueryKey,
  queryOptions,
} from "@tanstack/react-query";
import type { Role } from "../../lib/roles.ts";
import type { AdminActionError, AdminActionResult, BulkActionResult } from "./actions.ts";
import type { UserDetail } from "./detail.ts";
import { getAdminUser, listAdminUsers } from "./functions.ts";
import type { UserRow } from "./queries.ts";
import type { BlockUserForm, ListUsersInput } from "./schemas.ts";

/**
 * The query keys of the Users screen, from the widest to the narrowest, so an action
 * invalidates exactly what it changed.
 */
export const usersKeys = {
  all: ["admin-users"] as const,
  lists: () => [...usersKeys.all, "list"] as const,
  list: (filters: ListUsersInput) => [...usersKeys.lists(), filters] as const,
  details: () => [...usersKeys.all, "detail"] as const,
  detail: (userId: string) => [...usersKeys.details(), userId] as const,
};

/**
 * One page of the users table, keyed by the whole table state. While the next page or filter
 * loads, the previous page stays on screen (`keepPreviousData`), so the table never flashes empty.
 */
export function adminUsersQueryOptions(input: ListUsersInput) {
  return queryOptions({
    queryKey: usersKeys.list(input),
    queryFn: () => listAdminUsers({ data: input }),
    placeholderData: keepPreviousData,
  });
}

/** The page of users {@link adminUsersQueryOptions} returns. */
export type AdminUsersPage = Awaited<ReturnType<typeof listAdminUsers>>;

/** The user detail sheet of one user. */
export function adminUserQueryOptions(userId: string) {
  return queryOptions({
    queryKey: usersKeys.detail(userId),
    queryFn: () => getAdminUser({ data: { userId } }),
  });
}

/** An action the server refused: the code maps to a translated message at the edge. */
export class AdminActionRefused extends Error {
  readonly code: AdminActionError;

  constructor(code: AdminActionError) {
    super(code);
    this.name = "AdminActionRefused";
    this.code = code;
  }
}

/** Returns the refusal code of a failed action; anything but a refusal is `failed`. */
export function actionErrorCode(error: unknown): AdminActionError {
  return error instanceof AdminActionRefused ? error.code : "failed";
}

/** Calls an action and throws its refusal, so a refused action rolls back like a failed one. */
async function settled<TInput>(call: ActionCall<TInput>, data: TInput): Promise<void> {
  const result = await call({ data });
  if (!result.ok) throw new AdminActionRefused(result.error);
}

/** A server function of one action, as `useServerFn` returns it. */
export type ActionCall<TInput> = (options: { data: TInput }) => Promise<AdminActionResult>;

/** A server function of a bulk action, as `useServerFn` returns it. */
export type BulkActionCall<TInput> = (options: { data: TInput }) => Promise<BulkActionResult>;

/** The cache entries an optimistic update replaced, to put back on failure. */
export interface UsersSnapshot {
  entries: [QueryKey, unknown][];
}

/** Invalidates what an action on `userIds` changed: their details and every list page. */
export async function invalidateUsers(
  queryClient: QueryClient,
  userIds: readonly string[],
): Promise<void> {
  await Promise.all([
    ...userIds.map((userId) =>
      queryClient.invalidateQueries({ queryKey: usersKeys.detail(userId) }),
    ),
    queryClient.invalidateQueries({ queryKey: usersKeys.lists() }),
  ]);
}

/**
 * Writes an optimistic change of one user into the cached list pages and their detail, after
 * cancelling their fetches, and returns what it replaced.
 */
export async function patchUserInCache(
  queryClient: QueryClient,
  userId: string,
  patch: { row?: (row: UserRow) => UserRow; detail?: (detail: UserDetail) => UserDetail },
): Promise<UsersSnapshot> {
  await Promise.all([
    queryClient.cancelQueries({ queryKey: usersKeys.lists() }),
    queryClient.cancelQueries({ queryKey: usersKeys.detail(userId) }),
  ]);
  const entries: [QueryKey, unknown][] = [
    ...queryClient.getQueriesData({ queryKey: usersKeys.lists() }),
    [usersKeys.detail(userId), queryClient.getQueryData(usersKeys.detail(userId))],
  ];
  const { row, detail } = patch;
  if (row) {
    queryClient.setQueriesData<AdminUsersPage>({ queryKey: usersKeys.lists() }, (page) =>
      page
        ? { ...page, rows: page.rows.map((item) => (item.id === userId ? row(item) : item)) }
        : page,
    );
  }
  if (detail) {
    queryClient.setQueryData<UserDetail>(usersKeys.detail(userId), (current) =>
      current ? detail(current) : current,
    );
  }
  return { entries };
}

/** Puts back what {@link patchUserInCache} replaced. */
export function restoreUsers(queryClient: QueryClient, snapshot: UsersSnapshot | undefined): void {
  for (const [key, value] of snapshot?.entries ?? []) queryClient.setQueryData(key, value);
}

/**
 * Ends one session of a user, optimistically: the session leaves the sheet and the user's
 * session count drops at once, and both come back if the server refuses or fails.
 */
export function endSessionMutationOptions(
  queryClient: QueryClient,
  call: ActionCall<{ userId: string; sessionId: string }>,
) {
  return mutationOptions({
    mutationFn: (data: { userId: string; sessionId: string }) => settled(call, data),
    onMutate: (data) =>
      patchUserInCache(queryClient, data.userId, {
        row: (row) => ({ ...row, activeSessions: Math.max(0, row.activeSessions - 1) }),
        detail: (detail) => ({
          ...detail,
          sessions: detail.sessions.filter((session) => session.id !== data.sessionId),
        }),
      }),
    onError: (_error, _data, snapshot) => restoreUsers(queryClient, snapshot),
    onSettled: (_result, _error, data) => invalidateUsers(queryClient, [data.userId]),
  });
}

/**
 * Ends every session of a user, optimistically: the session count shows 0 (on the
 * administrator's own account, the current session stays) until the server answers.
 */
export function endAllSessionsMutationOptions(
  queryClient: QueryClient,
  call: ActionCall<{ userId: string }>,
) {
  return mutationOptions({
    mutationFn: (data: { userId: string }) => settled(call, data),
    onMutate: (data) =>
      patchUserInCache(queryClient, data.userId, {
        detail: (detail) => ({
          ...detail,
          sessions: detail.sessions.filter((session) => session.current),
        }),
        row: (row) => ({ ...row, activeSessions: 0 }),
      }),
    onError: (_error, _data, snapshot) => restoreUsers(queryClient, snapshot),
    onSettled: (_result, _error, data) => invalidateUsers(queryClient, [data.userId]),
  });
}

/** Sets a local role set, optimistically in the sheet and the list, rolled back on failure. */
export function setRolesMutationOptions(
  queryClient: QueryClient,
  call: ActionCall<{ userId: string; roles: Role[] }>,
) {
  return mutationOptions({
    mutationFn: (data: { userId: string; roles: Role[] }) => settled(call, data),
    onMutate: (data) =>
      patchUserInCache(queryClient, data.userId, {
        row: (row) => ({ ...row, roles: data.roles }),
        detail: (detail) => ({ ...detail, roles: data.roles }),
      }),
    onError: (_error, _data, snapshot) => restoreUsers(queryClient, snapshot),
    onSettled: (_result, _error, data) => invalidateUsers(queryClient, [data.userId]),
  });
}

/** Blocks a user (no optimistic change: the block also ends sessions the server knows). */
export function blockUserMutationOptions(
  queryClient: QueryClient,
  call: ActionCall<BlockUserForm & { userId: string }>,
) {
  return mutationOptions({
    mutationFn: (data: BlockUserForm & { userId: string }) => settled(call, data),
    onSettled: (_result, _error, data) => invalidateUsers(queryClient, [data.userId]),
  });
}

/** Lifts the block of a user. */
export function unblockUserMutationOptions(
  queryClient: QueryClient,
  call: ActionCall<{ userId: string }>,
) {
  return mutationOptions({
    mutationFn: (data: { userId: string }) => settled(call, data),
    onSettled: (_result, _error, data) => invalidateUsers(queryClient, [data.userId]),
  });
}

/** Ends every session of each selected user; the result says who was refused. */
export function bulkEndSessionsMutationOptions(
  queryClient: QueryClient,
  call: BulkActionCall<{ userIds: string[] }>,
) {
  return mutationOptions({
    mutationFn: (data: { userIds: string[] }) => call({ data }),
    onSettled: (_result, _error, data) => invalidateUsers(queryClient, data.userIds),
  });
}

/** Blocks each selected user with one reason; the result says who was refused. */
export function bulkBlockMutationOptions(
  queryClient: QueryClient,
  call: BulkActionCall<BlockUserForm & { userIds: string[] }>,
) {
  return mutationOptions({
    mutationFn: (data: BlockUserForm & { userIds: string[] }) => call({ data }),
    onSettled: (_result, _error, data) => invalidateUsers(queryClient, data.userIds),
  });
}
