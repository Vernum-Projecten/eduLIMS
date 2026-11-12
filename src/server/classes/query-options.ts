// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The TanStack Query layer of classes (#28): one key factory, the query options of each read and
// the mutation options of each write. A write invalidates the class it changed and the lists.
import {
  keepPreviousData,
  mutationOptions,
  type QueryClient,
  queryOptions,
} from "@tanstack/react-query";
import { STALE_TIME } from "../../lib/query-config.ts";
import type { ClassActionError, ClassResult } from "./access.ts";
import {
  getClassPage,
  getStudentClasses,
  listAllClasses,
  listGroupSetSourcesFn,
  listMyClasses,
} from "./functions.ts";

/** The query keys of classes, from the widest to the narrowest. */
export const classesKeys = {
  all: ["classes"] as const,
  lists: () => [...classesKeys.all, "list"] as const,
  list: (filters: { archived: boolean }) => [...classesKeys.lists(), filters] as const,
  details: () => [...classesKeys.all, "detail"] as const,
  detail: (classId: string) => [...classesKeys.details(), classId] as const,
  sources: (classId: string) => [...classesKeys.detail(classId), "sources"] as const,
  admin: () => [...classesKeys.all, "admin"] as const,
  student: () => [...classesKeys.all, "student"] as const,
};

/** The teacher's class list, active or archived. */
export function myClassesQueryOptions(filters: { archived: boolean }) {
  return queryOptions({
    queryKey: classesKeys.list(filters),
    queryFn: () => listMyClasses({ data: filters }),
    staleTime: STALE_TIME.classes,
    placeholderData: keepPreviousData,
    throwOnError: (_error, query) => query.state.data === undefined,
  });
}

/** The class page of one class. */
export function classPageQueryOptions(classId: string) {
  return queryOptions({
    queryKey: classesKeys.detail(classId),
    queryFn: () => getClassPage({ data: { classId } }),
    staleTime: STALE_TIME.classes,
  });
}

/** The page {@link classPageQueryOptions} returns. */
export type ClassPage = Awaited<ReturnType<typeof getClassPage>>;

/** The teacher's other classes with group sets, for "copy a group set". */
export function groupSetSourcesQueryOptions(classId: string) {
  return queryOptions({
    queryKey: classesKeys.sources(classId),
    queryFn: () => listGroupSetSourcesFn({ data: { classId } }),
    staleTime: STALE_TIME.classes,
  });
}

/** Every class, for the Admin portal. */
export function adminClassesQueryOptions() {
  return queryOptions({
    queryKey: classesKeys.admin(),
    queryFn: () => listAllClasses(),
    staleTime: STALE_TIME.classes,
  });
}

/** The student's classes and pending invitations. */
export function studentClassesQueryOptions() {
  return queryOptions({
    queryKey: classesKeys.student(),
    queryFn: () => getStudentClasses(),
    staleTime: STALE_TIME.classes,
  });
}

/** A class action the server refused: the code maps to a translated message at the edge. */
export class ClassActionRefused extends Error {
  readonly code: ClassActionError;

  constructor(code: ClassActionError) {
    super(code);
    this.name = "ClassActionRefused";
    this.code = code;
  }
}

/** Returns the refusal code of a failed action; anything but a refusal is `null`. */
export function classErrorCode(error: unknown): ClassActionError | null {
  return error instanceof ClassActionRefused ? error.code : null;
}

/** A server function of one class action, as `useServerFn` returns it. */
export type ClassCall<TInput, TValue> = (options: { data: TInput }) => Promise<ClassResult<TValue>>;

/** Invalidates what a write to `classId` changed: its page and every list. */
export async function invalidateClass(
  queryClient: QueryClient,
  classId: string | null,
): Promise<void> {
  await Promise.all([
    ...(classId ? [queryClient.invalidateQueries({ queryKey: classesKeys.detail(classId) })] : []),
    queryClient.invalidateQueries({ queryKey: classesKeys.lists() }),
    queryClient.invalidateQueries({ queryKey: classesKeys.admin() }),
  ]);
}

/** Returns the class an action's input names, or `null` (creating a class names none). */
export function classIdOf(data: object): string | null {
  const value: unknown = Reflect.get(data, "classId");
  return typeof value === "string" ? value : null;
}

/**
 * The mutation options of one class action: the call throws its refusal, so the caller's
 * `onError` shows it, and the class and the lists are invalidated when it settles.
 */
export function classMutationOptions<TInput extends object, TValue>(
  queryClient: QueryClient,
  call: ClassCall<TInput, TValue>,
) {
  return mutationOptions({
    mutationFn: async (data: TInput): Promise<TValue> => {
      const result = await call({ data });
      if (!result.ok) throw new ClassActionRefused(result.error);
      return result.value;
    },
    onSettled: (_result, _error, data) => invalidateClass(queryClient, classIdOf(data)),
  });
}

/**
 * The mutation options of deleting a class: `leave` moves off the class page first, then its
 * cache entry is dropped (a refetch would only answer 404) and the lists are invalidated.
 */
export function deleteClassMutationOptions(
  queryClient: QueryClient,
  call: ClassCall<{ classId: string }, null>,
  leave: () => Promise<void>,
) {
  return mutationOptions({
    mutationFn: async (data: { classId: string }): Promise<null> => {
      const result = await call({ data });
      if (!result.ok) throw new ClassActionRefused(result.error);
      return null;
    },
    onSuccess: async (_result, data) => {
      await leave();
      queryClient.removeQueries({ queryKey: classesKeys.detail(data.classId) });
      await invalidateClass(queryClient, null);
    },
  });
}

/**
 * The mutation options of a read-only action that answers with a value (the invitation
 * preview): it throws a refusal and invalidates nothing.
 */
export function classReadMutationOptions<TInput, TValue>(call: ClassCall<TInput, TValue>) {
  return mutationOptions({
    mutationFn: async (data: TInput): Promise<TValue> => {
      const result = await call({ data });
      if (!result.ok) throw new ClassActionRefused(result.error);
      return result.value;
    },
  });
}
