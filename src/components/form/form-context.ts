// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { createFormHookContexts } from "@tanstack/react-form";

/**
 * The contexts the registered field and form components read: `useFieldContext` inside a
 * `form.AppField`, `useFormContext` inside a `form.AppForm`.
 */
export const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts();
