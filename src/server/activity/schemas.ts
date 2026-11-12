// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The inputs of the activity log screen (#36, B4): the table state in the URL and the user
// search of the actor and target filters. Shared by the route and the server functions, so both
// sides refuse the same input. Relative imports: the DB tests load this without the app aliases.
import { z } from "zod";
import { AUDIT_ACTIONS, AUDIT_OUTCOMES } from "../audit/events.ts";

/** The page sizes the activity table offers. */
export const ACTIVITY_PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_ACTIVITY_PAGE_SIZE = 25;

/** The one column the activity table sorts on: the time of the event. */
export const ACTIVITY_SORT_FIELDS = ["occurredAt"] as const;

/** The longest user search text; longer input is cut, never an error. */
export const USER_SEARCH_MAX_LENGTH = 100;

/** The most users a user search returns. */
export const USER_SEARCH_LIMIT = 8;

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar day `YYYY-MM-DD` that exists (no 2026-02-30). */
const day = z
  .string()
  .regex(DAY_PATTERN)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  });

const userId = z.string().min(1).max(128);

const pageSize = z.coerce
  .number()
  .int()
  .refine((value) => (ACTIVITY_PAGE_SIZES as readonly number[]).includes(value));

/** A multi-select filter in the URL: known values only; a single string counts as one. */
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
 * failing, so a hand-edited or old link still opens the log. A period whose first day lies after
 * its last is read the other way round.
 */
export const activityListSearchSchema = z
  .object({
    actor: userId.optional().catch(undefined),
    target: userId.optional().catch(undefined),
    action: searchValues(AUDIT_ACTIONS),
    outcome: searchValues(AUDIT_OUTCOMES),
    from: day.optional().catch(undefined),
    to: day.optional().catch(undefined),
    dir: z.enum(["asc", "desc"]).optional().catch(undefined),
    page: z.coerce.number().int().min(1).max(100_000).optional().catch(undefined),
    size: pageSize.optional().catch(undefined),
  })
  .transform((search) =>
    search.from && search.to && search.from > search.to
      ? { ...search, from: search.to, to: search.from }
      : search,
  );
export type ActivityListSearch = z.infer<typeof activityListSearchSchema>;

/** The search params that narrow the log. */
export const ACTIVITY_FILTER_KEYS = ["actor", "target", "action", "outcome", "from", "to"] as const;

function inputValues<const T extends readonly [string, ...string[]]>(values: T) {
  return z.array(z.enum(values)).min(1).max(values.length).optional();
}

/**
 * The input of `listAdminActivity`: the search params, strictly (a server function is an API).
 * The sort direction is of the event time; the id breaks ties in the same direction.
 */
export const listActivityInput = z
  .strictObject({
    actor: userId.optional(),
    target: userId.optional(),
    action: inputValues(AUDIT_ACTIONS),
    outcome: inputValues(AUDIT_OUTCOMES),
    from: day.optional(),
    to: day.optional(),
    dir: z.enum(["asc", "desc"]).optional(),
    page: z.number().int().min(1).max(100_000).optional(),
    size: pageSize.optional(),
  })
  .refine((input) => !input.from || !input.to || input.from <= input.to, {
    message: "the period ends before it starts",
    path: ["to"],
  });
export type ListActivityInput = z.infer<typeof listActivityInput>;

/** The input of the user search behind the actor and target filters. */
export const activityUserSearchInput = z.strictObject({
  q: z.string().trim().min(1).max(USER_SEARCH_MAX_LENGTH),
});
export type ActivityUserSearchInput = z.infer<typeof activityUserSearchInput>;
