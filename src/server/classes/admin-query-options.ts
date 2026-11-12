// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The TanStack Query reads of the administrator's class screens (#37), keyed by
// `classesKeys`. The writes use `classMutationOptions`, which invalidates the class's teacher
// and administrator pages and every list.
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { STALE_TIME } from "../../lib/query-config.ts";
import {
  getAdminClassFn,
  listAdminClassesFn,
  searchTeacherCandidatesFn,
} from "./admin-functions.ts";
import type { ListAdminClassesInput } from "./admin-schemas.ts";
import { classesKeys } from "./query-options.ts";

/**
 * One page of the administrator's class list, keyed by the whole list state. While the next
 * page or filter loads, the previous page stays on screen; a failure with no page to show
 * throws to the route's error state.
 */
export function adminClassesQueryOptions(input: ListAdminClassesInput) {
  return queryOptions({
    queryKey: classesKeys.adminList(input),
    queryFn: () => listAdminClassesFn({ data: input }),
    staleTime: STALE_TIME.classes,
    placeholderData: keepPreviousData,
    throwOnError: (_error, query) => query.state.data === undefined,
  });
}

/** The page {@link adminClassesQueryOptions} returns. */
export type AdminClassesPage = Awaited<ReturnType<typeof listAdminClassesFn>>;

/** The administrator's page of one class. */
export function adminClassQueryOptions(classId: string) {
  return queryOptions({
    queryKey: classesKeys.adminDetail(classId),
    queryFn: () => getAdminClassFn({ data: { classId } }),
    staleTime: STALE_TIME.classes,
  });
}

/** The page {@link adminClassQueryOptions} returns. */
export type AdminClassPageData = Awaited<ReturnType<typeof getAdminClassFn>>;

/** The users who can own a class whose name or address contains `q`, for the owner fields. */
export function teacherCandidatesQueryOptions(q: string) {
  const text = q.trim();
  return queryOptions({
    queryKey: classesKeys.teachers(text),
    queryFn: () => searchTeacherCandidatesFn({ data: { q: text } }),
    staleTime: STALE_TIME.classes,
    placeholderData: keepPreviousData,
  });
}
