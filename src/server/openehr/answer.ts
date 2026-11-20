// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// How the openEHR client reads an answer of FerroEHR: the status classified into a typed error,
// and a body parsed with its schema at the trust boundary.
import "@tanstack/react-start/server-only";
import type { ZodType } from "zod";
import {
  bearerChallengeError,
  failure,
  type OpenEhrResult,
  openEhrErrorCode,
  success,
} from "./errors.ts";
import { parseJson } from "./token.ts";

/** An answer of FerroEHR as the transport read it. */
export interface Answer {
  status: number;
  body: string | undefined;
  /** The `WWW-Authenticate` header (RFC 6750 §3), read for a 401 or 403. */
  challenge: string | null;
  /** The `ETag` header (ITS-REST 1.1.0, `Requests_and_responses.md`, "ETag"). */
  etag: string | null;
}

/** A success status the operation does not define, such as a `204` where a body was asked for. */
export function unexpectedStatus<T>(status: number): OpenEhrResult<T> {
  return failure({
    kind: "invalid_response",
    target: "ferroehr",
    status,
    problem: "unexpected_shape",
  });
}

/** Maps a non-success answer to its typed error; a success goes on. */
export function classify(answer: Answer): OpenEhrResult<Answer> {
  const { status, body } = answer;
  if (status >= 200 && status <= 299) {
    if (body === undefined) {
      return failure({
        kind: "invalid_response",
        target: "ferroehr",
        status,
        problem: "too_large",
      });
    }
    return success(answer);
  }
  const code = openEhrErrorCode(body);
  if (status === 401 || status === 403) {
    // NOTE: FerroEHR book v5.7.0, `using-the-api/index.md`, "Which status a credential problem
    // gets": the challenge's `error` names the refusal, the problem type names it otherwise.
    const challenge = bearerChallengeError(answer.challenge);
    return failure({ kind: "auth_refused", target: "ferroehr", status, reason: challenge ?? code });
  }
  return failure({ kind: "refused", target: "ferroehr", status, code });
}

/** Parses a JSON body with `schema`, mapping a failure to `invalid_response`. */
export function parseBody<T>(answer: Answer, schema: ZodType<T>): OpenEhrResult<T> {
  const json = parseJson(answer.body);
  const parsed = schema.safeParse(json);
  if (parsed.success) return success(parsed.data);
  return failure({
    kind: "invalid_response",
    target: "ferroehr",
    status: answer.status,
    problem: json === undefined ? "not_json" : "unexpected_shape",
    cause: parsed.error,
  });
}
