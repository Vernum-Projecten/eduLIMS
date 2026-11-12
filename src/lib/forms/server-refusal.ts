// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type {
  AnyFormApi,
  DeepKeys,
  ValidationLogicFn,
  ValidationLogicValidatorsFn,
} from "@tanstack/react-form";

/**
 * A refusal from a server function, already translated: a message for the whole form, and a
 * message per field it concerns.
 */
export interface ServerRefusal<TFormData> {
  readonly form?: string;
  readonly fields?: Partial<Record<DeepKeys<TFormData>, string>>;
}

/** The form state a form-level refusal is tied to. */
interface RefusalMoment {
  readonly submissionAttempts: number;
  readonly values: unknown;
}

/** A form-level refusal, with the moment it was given and a number that tells refusals apart. */
interface FormRefusal extends RefusalMoment {
  readonly message: string;
  readonly sequence: number;
}

/**
 * The form-level refusal of each form, keyed by its store: `useForm` hands components a copy of
 * the `FormApi` that `onSubmit` receives, and both share the store.
 */
const formRefusals = new WeakMap<object, FormRefusal>();
/** The number of the latest refusal of each form that marked a field, keyed like the above. */
const fieldRefusals = new WeakMap<object, number>();
let sequence = 0;

/**
 * Shows a server refusal at the fields it concerns and at the top of the form (WCAG 3.3.1).
 * A field refusal sits in the `onServer` slot of the field's error map and stays until that
 * field changes, or until the next submit, which sends an unchanged value again (with
 * {@link keepServerRefusals}). A form-level refusal stays until a value changes or the form is
 * submitted again; {@link formRefusal} reads it. A blur never clears either.
 */
export function applyServerRefusal<TFormData>(
  form: Pick<AnyFormApi, "setErrorMap" | "store"> & {
    readonly state: { readonly values: TFormData; readonly submissionAttempts: number };
  },
  refusal: ServerRefusal<TFormData>,
): void {
  if (refusal.form) {
    sequence += 1;
    formRefusals.set(form.store, {
      message: refusal.form,
      sequence,
      submissionAttempts: form.state.submissionAttempts,
      values: form.state.values,
    });
  } else {
    formRefusals.delete(form.store);
  }
  if (Object.values(refusal.fields ?? {}).some((message) => message)) {
    sequence += 1;
    fieldRefusals.set(form.store, sequence);
  }
  // Also notifies every subscriber of the form store, so `FormErrors` reads the new refusal.
  form.setErrorMap({ onServer: { fields: refusal.fields ?? {} } });
}

/**
 * Returns the form-level refusal that is still current for `state`: given at this submit, with
 * the values unchanged since. Pass the state a store selector receives, so it stays reactive.
 */
export function formRefusal(
  form: Pick<AnyFormApi, "store">,
  state: RefusalMoment,
): { readonly message: string; readonly sequence: number } | undefined {
  const refusal = formRefusals.get(form.store);
  if (
    refusal === undefined ||
    refusal.submissionAttempts !== state.submissionAttempts ||
    refusal.values !== state.values
  ) {
    return undefined;
  }
  return { message: refusal.message, sequence: refusal.sequence };
}

/**
 * Returns the number of the latest refusal that marked a field, or `undefined` before the
 * first. A new number means a new refusal, even with the same message.
 */
export function fieldRefusalNumber(form: Pick<AnyFormApi, "store">): number | undefined {
  return fieldRefusals.get(form.store);
}

/** Empties the `onServer` slot of the error map it runs for. */
const clearServerRefusal: ValidationLogicValidatorsFn = { fn: () => undefined, cause: "server" };

/**
 * Wraps a validation logic (such as `revalidateLogic()`) so the `onServer` slot clears only
 * when the user changes that field or submits again. TanStack Form clears it for every field
 * at any blur or change, so a click on submit would remove the refusal under the pointer.
 */
export function keepServerRefusals(logic: ValidationLogicFn): ValidationLogicFn {
  return (props) => {
    const { event } = props;
    // A field's own change (`fieldName` is set only when a field validates) or a submit.
    const clears =
      !event.async &&
      (event.type === "submit" || (event.type === "change" && event.fieldName !== undefined));
    // TanStack Form uses what `runValidation` returns, though the type says `void`.
    return logic({
      ...props,
      runValidation: ({ validators, form }) => {
        const kept = validators.filter((validator) => validator?.cause !== "server");
        return props.runValidation({
          validators: clears ? [...kept, clearServerRefusal] : kept,
          form,
        });
      },
    });
  };
}
