// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { AnyFormApi, DeepKeys } from "@tanstack/react-form";

/**
 * A refusal from a server function, already translated: a message for the whole form, and a
 * message per field it concerns.
 */
export interface ServerRefusal<TFormData> {
  readonly form?: string;
  readonly fields?: Partial<Record<DeepKeys<TFormData>, string>>;
}

/**
 * Shows a server refusal at the fields it concerns and at the top of the form, through the
 * `onServer` slot of TanStack Form's error map. The next change validates again and clears it,
 * so a corrected value never keeps a stale refusal. TanStack Form runs that clearing only in a
 * form with validators, which every eduLIMS form has (its shared Zod schema).
 */
export function applyServerRefusal<TFormData>(
  form: Pick<AnyFormApi, "setErrorMap"> & { readonly state: { readonly values: TFormData } },
  refusal: ServerRefusal<TFormData>,
): void {
  form.setErrorMap({ onServer: { form: refusal.form, fields: refusal.fields ?? {} } });
}
