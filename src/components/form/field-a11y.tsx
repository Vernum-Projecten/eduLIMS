// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { AnyFieldApi } from "@tanstack/react-form";
import { Loader2Icon } from "lucide-react";
import { type ReactNode, useId } from "react";
import { FieldDescription, FieldError } from "@/components/ui/field";

import { m } from "@/i18n/messages";
import { type ErrorMessage, errorMessages } from "@/lib/forms/errors";

/** The props every registered field takes: a visible label and optional help text. */
export interface BaseFieldProps {
  /** The visible label (WCAG 1.3.1, 3.3.2); a placeholder never replaces it. */
  readonly label: string;
  /** Help text under the control, linked with `aria-describedby`. */
  readonly description?: ReactNode;
  /** The control's id, when something outside the field moves focus to it. */
  readonly id?: string;
  readonly className?: string;
}

/** The ids and state one field needs to wire its label, help text and error to its control. */
export interface FieldA11y {
  readonly controlId: string;
  readonly descriptionId: string;
  readonly errorId: string;
  readonly statusId: string;
  readonly isInvalid: boolean;
  readonly isValidating: boolean;
  readonly errors: ErrorMessage[];
  /** The props of the focusable control: `id`, `name`, `aria-invalid`, `aria-describedby`. */
  readonly controlProps: {
    readonly id: string;
    readonly name: string;
    readonly "aria-invalid": boolean;
    readonly "aria-describedby": string | undefined;
  };
}

/**
 * Returns the accessibility wiring of a field: an error shows once the field is touched (a
 * submit touches every field), and `aria-describedby` names the help text and the error that
 * are on screen.
 */
export function useFieldA11y(field: AnyFieldApi, description: ReactNode, id?: string): FieldA11y {
  const base = useId();
  const controlId = id ?? `${base}control`;
  const descriptionId = `${base}description`;
  const errorId = `${base}error`;
  const statusId = `${base}status`;
  const { meta } = field.state;
  const errors = errorMessages(meta.errors);
  const isInvalid = meta.isTouched && errors.length > 0;
  const describedBy = [
    description ? descriptionId : undefined,
    isInvalid ? errorId : undefined,
  ].filter((id) => id !== undefined);
  return {
    controlId,
    descriptionId,
    errorId,
    statusId,
    isInvalid,
    isValidating: meta.isValidating,
    errors,
    controlProps: {
      id: controlId,
      name: field.name,
      "aria-invalid": isInvalid,
      "aria-describedby": describedBy.length > 0 ? describedBy.join(" ") : undefined,
    },
  };
}

/**
 * The help text, the "Checking…" status of an async validator and the error of a field, in
 * that order. The status is a live region that is always present, so a screen reader hears it
 * when it fills; the error is an alert (WCAG 3.3.1, 4.1.3).
 */
export function FieldFeedback({
  a11y,
  description,
}: Readonly<{ a11y: FieldA11y; description: ReactNode }>) {
  return (
    <>
      {description && <FieldDescription id={a11y.descriptionId}>{description}</FieldDescription>}
      <div
        id={a11y.statusId}
        role="status"
        className="flex items-center gap-2 text-sm text-muted-foreground empty:sr-only"
      >
        {a11y.isValidating && (
          <>
            <Loader2Icon
              aria-hidden="true"
              className="size-4 animate-spin motion-reduce:animate-none"
            />
            {m.form_checking()}
          </>
        )}
      </div>
      {a11y.isInvalid && <FieldError id={a11y.errorId} errors={a11y.errors} />}
    </>
  );
}
