// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The ids and the codes of a lab's Gen5 uploads (S4, #156), shared by the server and the screen.

declare const uploadIdBrand: unique symbol;

/** The id of a Gen5 upload. */
export type UploadId = string & { readonly [uploadIdBrand]: true };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Returns `value` as an {@link UploadId} when it is a UUID in its lower-case text form. */
export function parseUploadId(value: string): UploadId | null {
  return UUID.test(value) ? (value as UploadId) : null;
}

/** The most links and the most results one plate takes: one per well (security review of #372). */
export const UPLOAD_LINKS_MAX = 96;

/** The longest well position a link may send: `H12` (security review of #372). */
export const UPLOAD_WELL_MAX = 3;

/** The longest lab number a link may send: the analyser's patient ID field (S5, #372). */
export const UPLOAD_LAB_NUMBER_MAX = 16;

/** The longest result value a team may send as text, before it is parsed as a decimal. */
export const UPLOAD_VALUE_MAX = 32;

/**
 * Why one entered result of a linked plate is refused (S4, D9); each names the result by its
 * index in the list the team sent.
 */
export const UPLOAD_RESULT_REFUSALS = [
  "result_duplicate",
  "sample_not_linked",
  "test_not_requested",
  "not_upload_test",
  "calculated_by_edulims",
  "value_invalid",
] as const;
export type UploadResultRefusalCode = (typeof UPLOAD_RESULT_REFUSALS)[number];
