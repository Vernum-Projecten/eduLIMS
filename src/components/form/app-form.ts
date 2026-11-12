// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { createFormHook, defaultValidationLogic } from "@tanstack/react-form";
import {
  CheckboxField,
  CheckboxGroupField,
  RadioGroupField,
  SelectField,
  SwitchField,
} from "@/components/form/choice-fields";
import { DateField } from "@/components/form/date-field";
import { EmailListField } from "@/components/form/email-list-field";
import { FieldErrors } from "@/components/form/field-errors";
import { FormErrors, SubmitButton } from "@/components/form/form-components";
import { fieldContext, formContext } from "@/components/form/form-context";
import { NumberField, TextareaField, TextField } from "@/components/form/text-fields";
import { keepServerRefusals } from "@/lib/forms/server-refusal";

const formHook = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: {
    TextField,
    TextareaField,
    NumberField,
    SelectField,
    CheckboxField,
    CheckboxGroupField,
    RadioGroupField,
    SwitchField,
    DateField,
    EmailListField,
    FieldErrors,
  },
  formComponents: { SubmitButton, FormErrors },
});

/**
 * The one form hook of eduLIMS. `useAppForm` takes TanStack Form's options (`defaultValues`, the
 * shared Zod schema in `validators`, `onSubmit`) and gives a form whose `form.AppField` renders
 * the registered fields (`field.TextField`, …) and whose `form.AppForm` provides
 * `form.SubmitButton` and `form.FormErrors`. Its validation logic keeps a server refusal until
 * the user changes the field or submits again ({@link keepServerRefusals}).
 */
export const useAppForm: typeof formHook.useAppForm = (options) =>
  formHook.useAppForm({
    ...options,
    validationLogic: keepServerRefusals(options.validationLogic ?? defaultValidationLogic),
  });

/** `withForm` splits a large form into typed parts; `withFieldGroup` reuses a group of fields. */
export const { withForm, withFieldGroup } = formHook;
