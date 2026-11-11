// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useFieldContext } from "@/components/form/form-context";
import { FieldError } from "@/components/ui/field";
import { errorMessages } from "@/lib/forms/errors";

/**
 * The errors of a field that has no control of its own, such as an array field ("add at least
 * one criterion"), shown once it is touched. `id` lets the group it belongs to name it in
 * `aria-describedby`.
 */
export function FieldErrors({ id }: Readonly<{ id?: string }>) {
  const field = useFieldContext<unknown>();
  const { meta } = field.state;
  const errors = errorMessages(meta.errors);
  if (!meta.isTouched || errors.length === 0) return null;
  return <FieldError id={id} errors={errors} />;
}
