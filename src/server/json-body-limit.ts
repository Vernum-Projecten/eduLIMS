// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The size limit of a JSON body sent to a server function (ASVS 5.0 V5.2.1, V15.2.2, #347).
// TanStack Start reads that body whole (`request.json()`) before the function's middleware runs,
// so a request middleware checks it first: the declared length, then the body itself, counted
// as it streams from a clone and cut off once it passes the limit. Start then reads the other
// branch of the clone, which holds no more than the counted bytes.
import { logSecurityEvent } from "./security-log.ts";

// NOTE: #347; the largest input, a pasted list of 500 lines of 320 characters (D10), serializes to
// at most 808 KB of printable text; only control characters or U+2028 in bulk pass 1 MiB.
/** The most bytes a JSON body to a server function may declare and carry. */
export const JSON_BODY_MAX = 1024 * 1024;

/** A declared length: digits only, short enough to be an exact JavaScript number. */
const LENGTH = /^\d{1,15}$/;

/**
 * Returns whether Start reads the body of `request` as JSON: any method with a body and a content
 * type that names `application/json`, matched without regard to case, so the check covers every
 * request Start's own case-sensitive match takes.
 */
export function carriesJson(request: Request): boolean {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD") return false;
  const type = request.headers.get("content-type")?.toLowerCase() ?? "";
  return type.includes("application/json");
}

/**
 * Reads the clone `copy` of `request` to its end, or until it passes `limit` bytes, keeping none
 * of it. Over the limit it cancels both branches together: the source stops only when both are
 * cancelled, so awaiting one alone would wait for ever.
 *
 * @returns `true` when the whole body fits in `limit`.
 */
async function fitsIn(request: Request, copy: Request, limit: number): Promise<boolean> {
  if (copy.body === null) return true;
  const reader = copy.body.getReader();
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return true;
    size += value.byteLength;
    if (size > limit) {
      await Promise.all([reader.cancel(), request.body?.cancel()]);
      return false;
    }
  }
}

/**
 * Returns the status that refuses a JSON body to a server function, or `null` to let it through:
 * 411 without a valid `Content-Length`, 413 when the declared length or the body as it streams
 * passes `limit`. A request that carries no JSON is left alone and its body left unread.
 */
export async function jsonBodyRefusal(
  request: Request,
  limit: number = JSON_BODY_MAX,
): Promise<411 | 413 | null> {
  if (!carriesJson(request)) return null;
  const declared = request.headers.get("content-length")?.trim();
  if (declared === undefined || !LENGTH.test(declared)) return 411;
  if (Number(declared) > limit) return 413;
  return (await fitsIn(request, request.clone(), limit)) ? null : 413;
}

/** Returns the refusal response of {@link jsonBodyRefusal} and logs it, or `null`. */
export async function refuseJsonBody(
  request: Request,
  limit: number = JSON_BODY_MAX,
): Promise<Response | null> {
  const status = await jsonBodyRefusal(request, limit);
  if (status === null) return null;
  logSecurityEvent("warn", "input_validation_fail", {
    outcome: "refused",
    reason: status === 411 ? "json_length_missing" : "json_too_large",
    status,
  });
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}
