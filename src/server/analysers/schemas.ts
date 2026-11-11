// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The inputs of the analyser register (B3, #35): the table state in the URL and the create, edit
// and retire forms. Shared by the route, the forms and the server functions, so both sides
// refuse the same input.
import { z } from "zod";
import { m } from "@/i18n/messages";
import {
  ANALYSER_LOCATION_MAX,
  ANALYSER_MODEL_MAX,
  ANALYSER_NOTES_MAX,
  ANALYSER_ROUTES,
  ANALYSER_SERIAL_MAX,
  ANALYSER_STATUSES,
  EDITABLE_ANALYSER_STATUSES,
} from "@/lib/analysers";

/** The columns the register sorts on. */
export const ANALYSER_SORT_FIELDS = ["model", "serialNumber", "location", "updatedAt"] as const;
export type AnalyserSortField = (typeof ANALYSER_SORT_FIELDS)[number];

/** The page sizes the register offers. */
export const ANALYSER_PAGE_SIZES = [10, 25, 50, 100] as const;
export const DEFAULT_ANALYSER_PAGE_SIZE = 25;

/** The longest search text; longer input is cut in the URL, refused at the server function. */
export const ANALYSER_SEARCH_MAX_LENGTH = 100;

const pageSize = z.coerce
  .number()
  .int()
  .refine((value) => (ANALYSER_PAGE_SIZES as readonly number[]).includes(value));

/** A multi-select filter in the URL: known values only, nothing left means no filter. */
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
 * The register's state in the URL search params. Every key falls back to its default instead of
 * failing, so a hand-edited or old link still opens the list.
 */
export const analyserListSearchSchema = z.object({
  q: z
    .string()
    .transform((value) => {
      const text = value.trim().slice(0, ANALYSER_SEARCH_MAX_LENGTH);
      return text === "" ? undefined : text;
    })
    .optional()
    .catch(undefined),
  status: searchValues(ANALYSER_STATUSES),
  route: searchValues(ANALYSER_ROUTES),
  sort: z.enum(ANALYSER_SORT_FIELDS).optional().catch(undefined),
  dir: z.enum(["asc", "desc"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100_000).optional().catch(undefined),
  size: pageSize.optional().catch(undefined),
});
export type AnalyserListSearch = z.infer<typeof analyserListSearchSchema>;

/** The search params that narrow the list: the search text and the facets. */
export const ANALYSER_FILTER_KEYS = ["q", "status", "route"] as const;

function inputValues<const T extends readonly [string, ...string[]]>(values: T) {
  return z.array(z.enum(values)).min(1).max(values.length).optional();
}

/** The input of `listAdminAnalysers`: the search params, strictly (a server function is an API). */
export const listAnalysersInput = z.strictObject({
  q: z.string().max(ANALYSER_SEARCH_MAX_LENGTH).optional(),
  status: inputValues(ANALYSER_STATUSES),
  route: inputValues(ANALYSER_ROUTES),
  sort: z.enum(ANALYSER_SORT_FIELDS).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  page: z.number().int().min(1).max(100_000).optional(),
  size: pageSize.optional(),
});
export type ListAnalysersInput = z.infer<typeof listAnalysersInput>;

const analyserId = z.uuid();

/** The input of the reads and actions about one analyser. */
export const analyserIdInput = z.strictObject({ analyserId });

function requiredText(max: number, required: () => string, tooLong: () => string) {
  return z.string().trim().min(1, { error: required }).max(max, { error: tooLong });
}

/** The create and edit form of an analyser (B3; the fields of #35). */
export const analyserFormSchema = z.object({
  model: requiredText(
    ANALYSER_MODEL_MAX,
    () => m.admin_analysers_model_required(),
    () => m.admin_analysers_too_long({ max: String(ANALYSER_MODEL_MAX) }),
  ),
  serialNumber: requiredText(
    ANALYSER_SERIAL_MAX,
    () => m.admin_analysers_serial_required(),
    () => m.admin_analysers_too_long({ max: String(ANALYSER_SERIAL_MAX) }),
  ),
  location: requiredText(
    ANALYSER_LOCATION_MAX,
    () => m.admin_analysers_location_required(),
    () => m.admin_analysers_too_long({ max: String(ANALYSER_LOCATION_MAX) }),
  ),
  route: z
    .enum([...ANALYSER_ROUTES, ""])
    .refine((value) => value !== "", { error: () => m.admin_analysers_route_required() }),
  status: z.enum(EDITABLE_ANALYSER_STATUSES, {
    error: () => m.admin_analysers_status_required(),
  }),
  notes: z.string().max(ANALYSER_NOTES_MAX, {
    error: () => m.admin_analysers_too_long({ max: String(ANALYSER_NOTES_MAX) }),
  }),
});
export type AnalyserForm = z.input<typeof analyserFormSchema>;

/** The input of `createAdminAnalyser`. */
export const createAnalyserInput = analyserFormSchema.strict();
export type CreateAnalyserInput = z.output<typeof createAnalyserInput>;

/** The input of `updateAdminAnalyser`: the form and the analyser. */
export const updateAnalyserInput = analyserFormSchema.extend({ analyserId }).strict();
export type UpdateAnalyserInput = z.output<typeof updateAnalyserInput>;
