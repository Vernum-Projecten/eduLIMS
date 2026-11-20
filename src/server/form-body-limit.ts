// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The size limit of a form sent to a server function (ASVS 5.0 V5.2.1, #292). TanStack Start
// reads a multipart or URL-encoded body whole (`request.formData()`) before the function's
// middleware runs, so the limit is checked on the declared length first: a form without a
// `Content-Length` or over the limit is refused before a byte of it is read. Node's HTTP parser
// reads no more than the declared length as the body.
import { LOGO_MAX_BYTES } from "../lib/lab-logo.ts";
import { toRequestId } from "./audit/events.ts";
import { logSecurityEvent } from "./security-log.ts";

// NOTE: #292; the logo is the one file a form carries, plus room for its field names and part
// headers. A larger upload (the Gen5 export, #156) raises this with its own decision.
/** The most bytes a form body to a server function may declare. */
export const FORM_BODY_MAX = LOGO_MAX_BYTES + 16 * 1024;

const FORM_TYPES = ["multipart/form-data", "application/x-www-form-urlencoded"];

/**
 * Returns the status that refuses a form body to a server function, or `null` to let it through:
 * 411 without a valid `Content-Length`, 413 over {@link FORM_BODY_MAX}. Any other request, a JSON
 * call included, is not this check's business.
 */
export function formBodyRefusal(request: Request): 411 | 413 | null {
  const type = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!FORM_TYPES.some((form) => type.includes(form))) return null;
  const declared = request.headers.get("content-length");
  if (declared === null || !/^\d{1,15}$/.test(declared.trim())) return 411;
  return Number(declared) > FORM_BODY_MAX ? 413 : null;
}

/**
 * Returns the refusal response of {@link formBodyRefusal} and logs it with the request id the
 * reverse proxy set, or `null`.
 */
export function refuseFormBody(request: Request): Response | null {
  const status = formBodyRefusal(request);
  if (status === null) return null;
  // NOTE: #357; a request middleware runs before any session middleware, so no user is known.
  logSecurityEvent("warn", "input_validation_fail", {
    outcome: "refused",
    reason: status === 411 ? "form_length_missing" : "form_too_large",
    status,
    request_id: toRequestId(request.headers.get("x-request-id")),
  });
  // NOTE: security review of #349; without `Connection: close` Node drains the unread body to
  // keep the connection alive, so a refused 200 MiB form is still read whole.
  return new Response(null, {
    status,
    headers: { "Cache-Control": "no-store", Connection: "close" },
  });
}
