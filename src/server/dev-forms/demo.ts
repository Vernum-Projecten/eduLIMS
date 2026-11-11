// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The stub answers of the `/dev/forms` server functions: fictional rubric titles that count as
// taken, so the debounced check and the refusal at submit can be seen. Nothing is stored.

/** Fictional rubrics that "already exist". */
export const TAKEN_DEMO_TITLES = ["Titration basics", "Microplate absorbance"] as const;

/** Returns whether `title` names one of the fictional rubrics, ignoring case and spaces. */
export function isTakenDemoTitle(title: string): boolean {
  const wanted = title.trim().toLowerCase();
  return TAKEN_DEMO_TITLES.some((taken) => taken.toLowerCase() === wanted);
}

/** Why the stub refuses a form: a field it concerns, or the form as a whole. */
export type DemoRefusal = { readonly kind: "title_taken" } | { readonly kind: "simulated" };

/** The answer of a stub submit. */
export type DemoResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly refusal: DemoRefusal };

/** Reviews a rubric as a real server would at submit: the title may be taken since the check. */
export function reviewDemoRubric(rubric: { readonly title: string }): DemoResult {
  return isTakenDemoTitle(rubric.title)
    ? { ok: false, refusal: { kind: "title_taken" } }
    : { ok: true };
}

/** Reviews a session form; `simulateRefusal` asks for a refusal of the whole form. */
export function reviewDemoSession(session: { readonly simulateRefusal: boolean }): DemoResult {
  return session.simulateRefusal ? { ok: false, refusal: { kind: "simulated" } } : { ok: true };
}
