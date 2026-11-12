// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The inputs of the administrator's class screens (#37): the list state in the URL, and the
// forms and actions of the class detail page. Shared by the routes, the forms and the server
// functions, so both sides refuse the same input.
import { z } from "zod";
import { m } from "@/i18n/messages";
import { isAcademicYear } from "@/lib/classes";
import { classFormSchema, INVITE_LIST_MAX } from "./schemas.ts";

/** The archive states the list filters on. */
export const ADMIN_CLASS_STATUSES = ["active", "archived"] as const;
export type AdminClassStatus = (typeof ADMIN_CLASS_STATUSES)[number];

/** The archive states the list shows when the URL names none: active classes, as for teachers. */
export const DEFAULT_ADMIN_CLASS_STATUS: readonly AdminClassStatus[] = ["active"];

/** The page sizes the list offers. */
export const ADMIN_CLASS_PAGE_SIZES = [10, 25, 50, 100] as const;
export const DEFAULT_ADMIN_CLASS_PAGE_SIZE = 25;

/** The longest search text; longer input is cut, never an error. */
export const ADMIN_CLASS_SEARCH_MAX = 100;

// NOTE: no requirement governs this: our own design. A bound on the values one facet names.
export const ADMIN_CLASS_FACET_MAX = 40;

const userId = z.string().min(1).max(128);

const pageSize = z.coerce
  .number()
  .int()
  .refine((value) => (ADMIN_CLASS_PAGE_SIZES as readonly number[]).includes(value));

/**
 * A multi-select filter in the URL: the values `keep` accepts (a single string counts as one),
 * without duplicates; nothing left means no filter.
 */
function searchList<T extends string>(keep: (value: unknown) => value is T) {
  return z
    .preprocess(
      (value) => (typeof value === "string" ? [value] : value),
      z.array(z.unknown()).max(ADMIN_CLASS_FACET_MAX * 2),
    )
    .transform((list) => {
      const known = [...new Set(list.filter(keep))].slice(0, ADMIN_CLASS_FACET_MAX);
      return known.length > 0 ? known : undefined;
    })
    .optional()
    .catch(undefined);
}

function isStatus(value: unknown): value is AdminClassStatus {
  return (ADMIN_CLASS_STATUSES as readonly unknown[]).includes(value);
}

function isYear(value: unknown): value is string {
  return typeof value === "string" && isAcademicYear(value);
}

function isUserId(value: unknown): value is string {
  return userId.safeParse(value).success;
}

/**
 * The class list's state in the URL search params. Every key falls back to its default instead
 * of failing, so a hand-edited or old link still opens the list.
 */
export const adminClassListSearchSchema = z.object({
  q: z
    .string()
    .transform((value) => {
      const text = value.trim().slice(0, ADMIN_CLASS_SEARCH_MAX);
      return text === "" ? undefined : text;
    })
    .optional()
    .catch(undefined),
  status: searchList(isStatus),
  year: searchList(isYear),
  owner: searchList(isUserId),
  /** Only the classes whose owner is not a teacher (#37); `true` or absent. */
  ownerNotTeacher: z
    .preprocess(
      (value) => value === true || value === "true" || undefined,
      z.literal(true).optional(),
    )
    .catch(undefined),
  page: z.coerce.number().int().min(1).max(100_000).optional().catch(undefined),
  size: pageSize.optional().catch(undefined),
});
export type AdminClassListSearch = z.infer<typeof adminClassListSearchSchema>;

/** The search params that narrow the list. */
export const ADMIN_CLASS_FILTER_KEYS = ["q", "status", "year", "owner", "ownerNotTeacher"] as const;

/** The input of the list read: the search params, strictly (a server function is an API). */
export const listAdminClassesInput = z.strictObject({
  q: z.string().max(ADMIN_CLASS_SEARCH_MAX).optional(),
  status: z.array(z.enum(ADMIN_CLASS_STATUSES)).min(1).max(2).optional(),
  year: z.array(z.string().refine(isAcademicYear)).min(1).max(ADMIN_CLASS_FACET_MAX).optional(),
  owner: z.array(userId).min(1).max(ADMIN_CLASS_FACET_MAX).optional(),
  ownerNotTeacher: z.literal(true).optional(),
  page: z.number().int().min(1).max(100_000).optional(),
  size: pageSize.optional(),
});
export type ListAdminClassesInput = z.infer<typeof listAdminClassesInput>;

/** The owner field of the administrator's forms: a user id picked from the teachers. */
const ownerField = z
  .string()
  .min(1, { error: () => m.classes_admin_owner_required() })
  .max(128);

/** "New class" on a teacher's behalf: a name, an academic year and the owner (B2). */
export const adminClassFormSchema = classFormSchema.extend({ ownerId: ownerField });
export type AdminClassForm = z.input<typeof adminClassFormSchema>;

/** "Transfer ownership": the new owner. */
export const transferFormSchema = z.object({ userId: ownerField });
export type TransferForm = z.input<typeof transferFormSchema>;

/** The input of "Transfer ownership". */
export const adminTransferInput = transferFormSchema.extend({ classId: z.uuid() });

/** The import form: the student addresses, typed, pasted or read from a CSV file (B2). */
export const importFormSchema = z.object({
  emails: z
    .array(z.string())
    .min(1, { error: () => m.classes_invite_emails_required() })
    .max(INVITE_LIST_MAX, {
      error: () => m.form_email_list_too_many({ max: String(INVITE_LIST_MAX) }),
    }),
});
export type ImportForm = z.input<typeof importFormSchema>;

/**
 * The input of the import preview and the import. The server classifies every address itself,
 * so a malformed one is reported in the preview, never refused as a whole.
 */
export const adminImportInput = z.object({
  classId: z.uuid(),
  emails: z.array(z.string().max(320)).min(1).max(INVITE_LIST_MAX),
});

/** The input of the owner search: the text typed, cut to the search limit. */
export const teacherSearchInput = z.strictObject({ q: z.string().max(ADMIN_CLASS_SEARCH_MAX) });
