// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The size limit of a form sent to a server function (ASVS 5.0 V5.2.1, #292). TanStack Start
// reads a multipart or URL-encoded body whole (`request.formData()`) before the function's
// middleware runs, so the limit is checked on the declared length first: a form without a
// `Content-Length` or over the limit is refused before a byte of it is read. Node's HTTP parser
// reads no more than the declared length as the body.
import { LOGO_MAX_BYTES } from "../lib/lab-logo.ts";
import { logBodyRefusal } from "./body-refusal-log.ts";
import { BODY_REFUSAL_HEADERS } from "./json-body-limit.ts";
import { MAX_UPLOAD_BYTES } from "./upload/limits.ts";

/** The room a form needs beside its one file: the id field, part headers, boundaries, context. */
const FORM_FRAMING = 16 * 1024;

// NOTE: #292; the logo is the one file a form carries, plus room for its field names and part
// headers. Every form but the Gen5 upload's is held to this.
/** The most bytes a form body to a server function may declare. */
export const FORM_BODY_MAX = LOGO_MAX_BYTES + FORM_FRAMING;

// NOTE: owner, 2026-11-20 on #156; the 5 MiB file plus the same 16 KiB as the logo's form for
// the lab's id, the file's part headers with its name, the boundaries and Start's context field.
/**
 * The most bytes the form of the Gen5 upload's server function (#156) may declare, for a caller
 * with a valid session only (`gateGen5Upload`, src/server/upload/upload-gate.ts).
 */
export const GEN5_FORM_BODY_MAX = MAX_UPLOAD_BYTES + FORM_FRAMING;

const FORM_TYPES = ["multipart/form-data", "application/x-www-form-urlencoded"];

/**
 * Returns the status that refuses a form body to a server function, or `null` to let it through:
 * 411 without a valid `Content-Length`, 413 over `limit`. Any other request, a JSON call
 * included, is not this check's business.
 */
export function formBodyRefusal(request: Request, limit: number = FORM_BODY_MAX): 411 | 413 | null {
  const type = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!FORM_TYPES.some((form) => type.includes(form))) return null;
  const declared = request.headers.get("content-length");
  if (declared === null || !/^\d{1,15}$/.test(declared.trim())) return 411;
  return Number(declared) > limit ? 413 : null;
}

/**
 * Returns the refusal response of {@link formBodyRefusal} and logs it through the deduplicated
 * body refusal log, or `null`.
 */
export function refuseFormBody(request: Request, limit: number = FORM_BODY_MAX): Response | null {
  const status = formBodyRefusal(request, limit);
  if (status === null) return null;
  logBodyRefusal(request, {
    reason: status === 411 ? "form_length_missing" : "form_too_large",
    status,
  });
  // NOTE: security review of #349; without `Connection: close` Node drains the unread body to
  // keep the connection alive, so a refused 200 MiB form is still read whole.
  return new Response(null, { status, headers: BODY_REFUSAL_HEADERS });
}
