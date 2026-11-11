// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// What TanStack Form keeps as a field or form error: a string from a validator function or a
// server refusal, a Standard Schema issue (Zod) with a `message`, or an array of either.

/** One error as the shadcn `FieldError` renders it. */
export interface ErrorMessage {
  readonly message: string;
}

function collect(error: unknown, into: string[]): void {
  if (typeof error === "string") {
    if (error !== "") into.push(error);
  } else if (Array.isArray(error)) {
    for (const item of error) collect(item, into);
  } else if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message !== ""
  ) {
    into.push(error.message);
  }
}

/**
 * Returns the messages of TanStack Form errors, once each and in order. Anything without a
 * message (an `undefined` slot of the error map, a bare object) is skipped.
 */
export function errorMessages(errors: readonly unknown[]): ErrorMessage[] {
  const messages: string[] = [];
  collect(errors, messages);
  return [...new Set(messages)].map((message) => ({ message }));
}
