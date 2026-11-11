// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The inputs of the Users screen (#34): the table state in the URL, and the actions of the user
// detail sheet. Shared by the route, the forms and the server functions, so both sides refuse
// the same input.
import { z } from "zod";
import { m } from "@/i18n/messages";
import { dayIn } from "@/lib/app-day";
import { ROLES, validateRoleSet } from "@/lib/roles";
import { SIGN_IN_METHODS } from "@/lib/sign-in-method";

/** The user statuses the table filters on and shows. */
export const USER_STATUSES = ["active", "blocked", "never"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** The columns the table sorts on. */
export const USER_SORT_FIELDS = ["name", "lastSignIn"] as const;
export type UserSortField = (typeof USER_SORT_FIELDS)[number];

/** The page sizes the table offers. */
export const USER_PAGE_SIZES = [10, 25, 50, 100] as const;
export const DEFAULT_USER_PAGE_SIZE = 25;

/** The longest search text; longer input is cut, never an error. */
export const SEARCH_MAX_LENGTH = 100;

const pageSize = z.coerce
  .number()
  .int()
  .refine((value) => (USER_PAGE_SIZES as readonly number[]).includes(value));

/**
 * A multi-select filter in the URL: an array of known values (a single string from an older or
 * hand-written link counts as one). Unknown values are dropped and duplicates removed; nothing
 * left means no filter.
 */
function searchValues<const T extends readonly [string, ...string[]]>(values: T) {
  return z
    .preprocess(
      (value) => (typeof value === "string" ? [value] : value),
      z.array(z.unknown()).max(values.length * 2),
    )
    .transform((list) => {
      const known = values.filter((value): value is T[number] => list.includes(value));
      return known.length > 0 ? known : undefined;
    })
    .optional()
    .catch(undefined);
}

/**
 * The table state in the URL search params. Every key falls back to its default instead of
 * failing, so a hand-edited or old link still opens the list. The facets are arrays: a user
 * matches when they have any of the chosen values (OR), and the facets combine with AND.
 */
export const userListSearchSchema = z.object({
  q: z
    .string()
    .transform((value) => {
      const text = value.trim().slice(0, SEARCH_MAX_LENGTH);
      return text === "" ? undefined : text;
    })
    .optional()
    .catch(undefined),
  role: searchValues(ROLES),
  provider: searchValues(SIGN_IN_METHODS),
  status: searchValues(USER_STATUSES),
  sort: z.enum(USER_SORT_FIELDS).optional().catch(undefined),
  dir: z.enum(["asc", "desc"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100_000).optional().catch(undefined),
  size: pageSize.optional().catch(undefined),
});
export type UserListSearch = z.infer<typeof userListSearchSchema>;

/** The search params that narrow the list: the search text and the facets. */
export const USER_FILTER_KEYS = ["q", "role", "provider", "status"] as const;

function inputValues<const T extends readonly [string, ...string[]]>(values: T) {
  return z.array(z.enum(values)).min(1).max(values.length).optional();
}

/** The input of `listAdminUsers`: the search params, strictly (a server function is an API). */
export const listUsersInput = z.strictObject({
  q: z.string().max(SEARCH_MAX_LENGTH).optional(),
  role: inputValues(ROLES),
  provider: inputValues(SIGN_IN_METHODS),
  status: inputValues(USER_STATUSES),
  sort: z.enum(USER_SORT_FIELDS).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  page: z.number().int().min(1).max(100_000).optional(),
  size: pageSize.optional(),
});
export type ListUsersInput = z.infer<typeof listUsersInput>;

const userId = z.string().min(1).max(128);

/** The input of the reads and actions about one user. */
export const userIdInput = z.strictObject({ userId });

// NOTE: no requirement governs this: our own design. One page at the largest page size.
export const BULK_MAX_USERS = 100;

const userIds = z
  .array(userId)
  .min(1)
  .max(BULK_MAX_USERS)
  .transform((ids) => [...new Set(ids)]);

/** The input of a bulk action: the selected users of one page. */
export const bulkUsersInput = z.strictObject({ userIds });

/** The input of "End session": the session's id, never its token. */
export const revokeSessionInput = z.strictObject({ userId, sessionId: z.string().min(1).max(128) });

// NOTE: no requirement governs this: our own design. A bound on what an administrator types.
export const BLOCK_REASON_MAX_LENGTH = 500;

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The block form (owner decision on #32: a reason, and an optional end date). The end date is
 * the last day of the block, a calendar day after today in the app's time zone (ADR 0011).
 */
export const blockUserFormSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, { error: () => m.admin_users_block_reason_required() })
    .max(BLOCK_REASON_MAX_LENGTH, {
      error: () => m.admin_users_block_reason_too_long({ max: String(BLOCK_REASON_MAX_LENGTH) }),
    }),
  until: z
    .string()
    .refine((value) => value === "" || DAY_PATTERN.test(value), {
      error: () => m.admin_users_block_until_invalid(),
    })
    .refine((value) => value === "" || value > dayIn(new Date()), {
      error: () => m.admin_users_block_until_past(),
    }),
});
export type BlockUserForm = z.infer<typeof blockUserFormSchema>;

/** The input of `blockAdminUser`: the block form and the user. */
export const blockUserInput = blockUserFormSchema.extend({ userId });

/** The input of the bulk block: one reason and end date for every selected user. */
export const bulkBlockUsersInput = blockUserFormSchema.extend({ userIds });

/** The role editor (owner decision on #32: local role sets only, ADR 0012 sets). */
export const userRolesFormSchema = z.object({
  roles: z
    .array(z.enum(ROLES))
    .refine((roles) => roles.length > 0, { error: () => m.admin_users_roles_required() })
    .refine((roles) => roles.length === 0 || validateRoleSet(roles).ok, {
      error: () => m.role_error_not_allowed(),
    }),
});
export type UserRolesForm = z.infer<typeof userRolesFormSchema>;

/** The input of `setAdminUserRoles`. */
export const setUserRolesInput = userRolesFormSchema.extend({ userId });
