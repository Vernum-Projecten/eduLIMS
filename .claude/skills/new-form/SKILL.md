---
name: new-form
description: Scaffolds an accessible form with shadcn/ui Field components, TanStack Form and one Zod schema shared with the POST server function that receives it, with labels and messages from the i18n layer (English source, Dutch translation), server-side refusals shown at the field, pending state, cache invalidation and tests. Use when adding any form (practical setup, sample registration, rubric scoring, user and role management).
allowed-tools: Read, Grep, Glob, Write, Edit, Bash
argument-hint: "<form name> e.g. register-sample"
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# /new-form

Build the form the way the shadcn TanStack Form guide does
(<https://ui.shadcn.com/docs/forms/tanstack-form>), held to
`.claude/rules/react-ui.md` §2 and §3 and `auth-security.md`.

## Before you write

1. Read the requirement (`/requirement-lookup`). Field rules (required, ranges,
   formats) come from the draft or an owner decision on the issue; a rule the
   draft does not state is a question for the owner, never an invented
   constraint.
2. Make sure the shadcn primitives exist: `src/components/ui/field.tsx`,
   `input.tsx`, `button.tsx` (and `select`, `textarea`, `checkbox` as
   needed). Add a missing one with `pnpm exec shadcn add field input` (or
   the `shadcn` MCP server); never hand-copy a component.
3. Confirm `zod` and `@tanstack/react-form` are dependencies; adding one is a
   `package.json` change with an exact version checked on the registry.

## The pieces

**One schema, two users**: `src/server/<area>/schemas.ts`. The form validates
with it and the server function's `.validator()` parses with it, so client
and server refuse the same input. Messages come from the i18n layer
(ADR 0011): pass a function so the message resolves in the active locale.
The snippets import message functions as `m` from `@/i18n/messages`; use the
path the existing code uses, and add every new key to both the `en` and the
`nl` catalogue under `messages/`.

```ts
// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import { m } from "@/i18n/messages";

export const registerSampleSchema = z.object({
  practicalId: z.uuid(),
  sampleType: z.enum(["blood", "serum", "plasma"], { error: () => m.sample_type_required() }),
  note: z.string().max(200, { error: () => m.note_too_long({ max: 200 }) }),
});
export type RegisterSampleInput = z.infer<typeof registerSampleSchema>;
```

**The server function** (`src/server/<area>/functions.ts`): `POST`, the role
middleware, `.validator(registerSampleSchema)`, ownership check, then the
write in a transaction. It returns the created record, or throws a typed
error the form can show.

**The form component** (`src/components/<area>/<name>-form.tsx`):

```tsx
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { m } from "@/i18n/messages";
import { registerSample } from "@/server/samples/functions";
import { registerSampleSchema } from "@/server/samples/schemas";

export function RegisterSampleForm({ practicalId }: { practicalId: string }) {
  const queryClient = useQueryClient();
  const submit = useServerFn(registerSample);
  const form = useForm({
    defaultValues: { practicalId, sampleType: "blood", note: "" },
    validators: { onSubmit: registerSampleSchema },
    onSubmit: async ({ value }) => {
      await submit({ data: value });
      await queryClient.invalidateQueries({ queryKey: ["samples", practicalId] });
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <FieldGroup>
        <form.Field name="note">
          {(field) => {
            const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>{m.sample_note_label()}</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  aria-invalid={isInvalid}
                />
                {isInvalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            );
          }}
        </form.Field>
      </FieldGroup>
      <form.Subscribe selector={(s) => s.isSubmitting}>
        {(isSubmitting) => (
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? m.saving() : m.sample_register_submit()}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
```

Check the shadcn guide for the current shape of `FieldError` and the select,
checkbox and radio variants before copying this.

## Rules to hold

- Every control has a visible `FieldLabel` tied by `htmlFor`/`id`; help text
  is a `FieldDescription`; never a placeholder as the label (WCAG 1.3.1,
  3.3.2).
- A server refusal (a deadline passed, an unknown sample ID) is shown at the
  field it concerns, or at the top of the form with focus moved to it, and
  announced (`role="alert"` or the toast).
- An irreversible submit (S6 lab report, D4 final grade) confirms with an
  `AlertDialog` that states what can no longer change.
- The submit button reflects `isSubmitting` and cannot double-submit.

## Tests

- **Schema unit tests:** every rule accepts the valid case and refuses each
  invalid case with its message, in the `en` and the `nl` locale.
- **Server function tests:** the validator rejects a crafted payload that
  bypasses the form; the role and ownership checks refuse other users.
- **E2E:** fill the form with the keyboard only, submit, see the result;
  submit invalid input and see each error by its label; axe finds zero
  WCAG 2.1 A/AA violations in both states.
