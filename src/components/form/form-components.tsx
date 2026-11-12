// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useStore } from "@tanstack/react-form";
import { CircleAlertIcon, Loader2Icon } from "lucide-react";
import { type ComponentProps, type ReactNode, useEffect, useRef } from "react";
import { useFormContext } from "@/components/form/form-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { m } from "@/i18n/messages";
import { errorMessages } from "@/lib/forms/errors";
import { fieldRefusalNumber, formRefusal } from "@/lib/forms/server-refusal";

/** A control that shows an error; a radio group is focused through its radios. */
const INVALID_CONTROL = '[aria-invalid="true"]:not([role="radiogroup"])';

/**
 * The submit button. It subscribes to `isSubmitting` only, so a keystroke in a field does not
 * render it; while the form submits (or `busy` holds) it shows a spinner and cannot submit twice.
 * It stays enabled while the form is invalid: a submit touches every field, so each error shows,
 * and focus moves to the first invalid control (WCAG 3.3.1). A button disabled on `canSubmit`
 * would hide that reason (a new, empty row makes the form invalid before anything is shown).
 * A server refusal that marks a field arrives later; focus then moves to the first control it
 * marks, unless the refusal also has a form-level message, which `FormErrors` focuses.
 */
export function SubmitButton({
  children,
  icon,
  busy = false,
  ...button
}: Omit<ComponentProps<typeof Button>, "type" | "disabled" | "asChild"> & {
  readonly icon?: ReactNode;
  /** Work outside the form that should also hold the button (a confirmation's mutation). */
  readonly busy?: boolean;
}) {
  const form = useFormContext();
  const isSubmitting = useStore(form.store, (state) => state.isSubmitting);
  const refusalNumber = useStore(form.store, () => fieldRefusalNumber(form));
  const own = useRef<HTMLButtonElement | null>(null);
  const passedRef = button.ref;
  useEffect(() => {
    if (refusalNumber === undefined || formRefusal(form, form.state) !== undefined) return;
    const owner = own.current?.form;
    // After this frame the refused fields have rendered `aria-invalid`.
    const frame = requestAnimationFrame(() =>
      owner?.querySelector<HTMLElement>(INVALID_CONTROL)?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [form, refusalNumber]);
  const pending = isSubmitting || busy;
  return (
    <Button
      {...button}
      ref={(node) => {
        own.current = node;
        if (typeof passedRef === "function") passedRef(node);
        else if (passedRef) passedRef.current = node;
      }}
      type="submit"
      disabled={pending}
      aria-busy={pending}
      onClick={(event) => {
        button.onClick?.(event);
        const owner = event.currentTarget.form;
        // After this frame the submit has validated and rendered its errors.
        requestAnimationFrame(() => owner?.querySelector<HTMLElement>(INVALID_CONTROL)?.focus());
      }}
    >
      {pending ? (
        <Loader2Icon
          aria-hidden="true"
          data-icon="inline-start"
          className="animate-spin motion-reduce:animate-none"
        />
      ) : (
        icon
      )}
      {children}
    </Button>
  );
}

/** Separates the refusal number from the messages in the selected string. */
const SEPARATOR = "\u001f";

/**
 * The form-level errors (a server refusal that concerns no single field), at the top of the
 * form. When they appear, and again for each new refusal, focus moves to them, so a keyboard
 * and screen-reader user lands on the reason (WCAG 3.3.1). A refusal stays until a value
 * changes or the form is submitted again. `title={null}` leaves the title out where the
 * message says it all (a refused sign-in).
 */
export function FormErrors({ title = m.form_errors_title() }: Readonly<{ title?: string | null }>) {
  const form = useFormContext();
  // A joined string is a stable selection, so the component renders only when it changes.
  const selected = useStore(form.store, (state) => {
    const refusal = formRefusal(form, state);
    const messages = errorMessages([state.errors, refusal?.message]).map((error) => error.message);
    return messages.length === 0 ? "" : [refusal?.sequence ?? 0, ...messages].join(SEPARATOR);
  });
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected !== "") ref.current?.focus();
  }, [selected]);
  if (selected === "") return null;
  const messages = selected.split(SEPARATOR).slice(1);
  return (
    <Alert
      ref={ref}
      tabIndex={-1}
      variant="destructive"
      className="outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <CircleAlertIcon aria-hidden="true" />
      {title !== null && <AlertTitle>{title}</AlertTitle>}
      <AlertDescription>
        {messages.length === 1 ? (
          messages[0]
        ) : (
          <ul className="list-disc pl-4">
            {messages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}
      </AlertDescription>
    </Alert>
  );
}
