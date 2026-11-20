// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The stub answers of the `/dev/forms` server functions: fictional sample numbers that count as
// linked to a request already, so the debounced check and the refusal at submit can be seen.
// Nothing is stored.

/** Fictional sample numbers that "already" belong to a request. */
export const TAKEN_DEMO_SAMPLE_NUMBERS = ["DEMO-101", "DEMO-102"] as const;

/** Returns whether `sampleNumber` is one of the fictional linked ones, ignoring case and spaces. */
export function isTakenDemoSampleNumber(sampleNumber: string): boolean {
  const wanted = sampleNumber.trim().toLowerCase();
  return TAKEN_DEMO_SAMPLE_NUMBERS.some((taken) => taken.toLowerCase() === wanted);
}

/** Why the stub refuses a form: a field it concerns, or the form as a whole. */
export type DemoRefusal = { readonly kind: "sample_number_taken" } | { readonly kind: "simulated" };

/** The answer of a stub submit. */
export type DemoResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly refusal: DemoRefusal };

/** Reviews a request as a real server would at submit: the number may be taken since the check. */
export function reviewDemoRequest(request: { readonly sampleNumber: string }): DemoResult {
  return isTakenDemoSampleNumber(request.sampleNumber)
    ? { ok: false, refusal: { kind: "sample_number_taken" } }
    : { ok: true };
}

/** Reviews a session form; `simulateRefusal` asks for a refusal of the whole form. */
export function reviewDemoSession(session: { readonly simulateRefusal: boolean }): DemoResult {
  return session.simulateRefusal ? { ok: false, refusal: { kind: "simulated" } } : { ok: true };
}
