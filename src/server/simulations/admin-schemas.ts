// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The inputs of the administrator's read-only list of simulations (B5, #291): the list's state
// in the URL and the server function's input. Shared by the route and the server function, so
// both sides accept the same page sizes and the same search length.
import { z } from "zod";

/** The page sizes the list offers; the server function accepts no other. */
export const ADMIN_SIMULATION_PAGE_SIZES = [10, 25, 50, 100] as const;
export const DEFAULT_ADMIN_SIMULATION_PAGE_SIZE = 25;

/** The longest search text; longer input is cut in the URL, refused at the server function. */
export const ADMIN_SIMULATION_SEARCH_MAX_LENGTH = 100;

/** The highest page number the list accepts. */
const MAX_PAGE = 100_000;

/** Control and format characters: PostgreSQL refuses a NUL in text, and none belongs in a name. */
const UNSEARCHABLE = /[\p{Cc}\p{Cf}]/u;
const UNSEARCHABLE_ALL = /[\p{Cc}\p{Cf}]/gu;

function isPageSize(value: number): boolean {
  return (ADMIN_SIMULATION_PAGE_SIZES as readonly number[]).includes(value);
}

/**
 * The list's state in the URL search params. Every key falls back to its default instead of
 * failing, so a hand-edited or old link still opens the list; control and format characters
 * are stripped from the search before it is trimmed (ASVS V2.2.1).
 */
export const adminSimulationListSearchSchema = z.object({
  q: z
    .string()
    .transform((value) => {
      const text = value
        .replace(UNSEARCHABLE_ALL, "")
        .trim()
        .slice(0, ADMIN_SIMULATION_SEARCH_MAX_LENGTH);
      return text === "" ? undefined : text;
    })
    .optional()
    .catch(undefined),
  page: z.coerce.number().int().min(1).max(MAX_PAGE).optional().catch(undefined),
  size: z.coerce.number().int().refine(isPageSize).optional().catch(undefined),
});
export type AdminSimulationListSearch = z.infer<typeof adminSimulationListSearchSchema>;

/**
 * The input of `listAdminSimulationsFn`: the search params, strictly (a server function is an
 * API). A control or format character in the search is refused (ASVS V2.2.1), and the page size
 * is an integer from the allow-list, never coerced.
 */
export const listAdminSimulationsInput = z.strictObject({
  q: z
    .string()
    .max(ADMIN_SIMULATION_SEARCH_MAX_LENGTH)
    .refine((value) => !UNSEARCHABLE.test(value))
    .optional(),
  page: z.number().int().min(1).max(MAX_PAGE).optional(),
  size: z.number().int().refine(isPageSize).optional(),
});
export type ListAdminSimulationsInput = z.infer<typeof listAdminSimulationsInput>;
