// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { queryOptions } from "@tanstack/react-query";
import { getAdminUser, listAdminUsers } from "./functions.ts";
import type { ListUsersInput } from "./schemas.ts";

/** The query keys of the Users screen; every action invalidates {@link ADMIN_USERS_KEY}. */
export const ADMIN_USERS_KEY = ["admin-users"] as const;

/** One page of the users table, keyed by the whole table state. */
export function adminUsersQueryOptions(input: ListUsersInput) {
  return queryOptions({
    queryKey: [...ADMIN_USERS_KEY, "list", input],
    queryFn: () => listAdminUsers({ data: input }),
  });
}

/** The user detail sheet of one user. */
export function adminUserQueryOptions(userId: string) {
  return queryOptions({
    queryKey: [...ADMIN_USERS_KEY, "detail", userId],
    queryFn: () => getAdminUser({ data: { userId } }),
  });
}
