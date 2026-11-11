---
name: new-form
description: Scaffolds an accessible form with shadcn/ui Field components, TanStack Form and one Zod schema shared with the POST server function that receives it, with labels and messages from the i18n layer (English source, Dutch translation), server-side refusals shown at the field, pending state, cache invalidation and tests. Use when adding any form (practical setup, sample registration, rubric scoring, user and role management).
allowed-tools: Read, Grep, Glob, Write, Edit, Bash
argument-hint: "<form name> e.g. register-sample"
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# /new-form

Build the form on the eduLIMS form foundation (`useAppForm` in
`src/components/form/`, #61), which follows the shadcn TanStack Form guide
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

**The form component** (`src/components/<area>/<name>-form.tsx`), on the
foundation in `src/components/form/` (`react-ui.md` §2). `/dev/forms` and
`src/components/dev-forms/` show every field, an async check, a server
refusal and a nested array editor (the rubric editor) working.

```tsx
import { revalidateLogic } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { SaveIcon } from "lucide-react";
import { useAppForm } from "@/components/form/app-form";
import { FieldGroup } from "@/components/ui/field";
import { m } from "@/i18n/messages";
import { applyServerRefusal } from "@/lib/forms/server-refusal";
import { isSampleIdFree, registerSample } from "@/server/samples/functions";
import { samplesKeys } from "@/server/samples/query-options";
import { registerSampleSchema } from "@/server/samples/schemas";

export function RegisterSampleForm({ practicalId }: Readonly<{ practicalId: string }>) {
  const queryClient = useQueryClient();
  const submit = useServerFn(registerSample);
  const check = useServerFn(isSampleIdFree);
  const form = useAppForm({
    defaultValues: { practicalId, sampleType: "" as const, note: "" },
    // Nothing shows before the first submit; then every change revalidates.
    validationLogic: revalidateLogic(),
    validators: { onDynamic: registerSampleSchema },
    onSubmit: async ({ value, formApi }) => {
      const result = await submit({ data: value });
      if (!result.ok) {
        // A typed refusal, translated here and shown at its field (or `form` for the top).
        applyServerRefusal(formApi, { fields: { note: m.sample_note_refused() } });
        return;
      }
      await queryClient.invalidateQueries({ queryKey: samplesKeys.list(practicalId) });
    },
  });

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.AppForm>
        <form.FormErrors />
        <FieldGroup>
          <form.AppField
            name="note"
            validators={{
              onChangeAsyncDebounceMs: 400,
              onChangeAsync: async ({ value, signal }) =>
                (await check({ data: { note: value }, signal })).free
                  ? undefined
                  : m.sample_note_taken(),
            }}
          >
            {(field) => (
              <field.TextField
                label={m.sample_note_label()}
                description={m.sample_note_help()}
                maxLength={200}
              />
            )}
          </form.AppField>
        </FieldGroup>
        <form.SubmitButton icon={<SaveIcon aria-hidden="true" data-icon="inline-start" />}>
          {m.sample_register_submit()}
        </form.SubmitButton>
      </form.AppForm>
    </form>
  );
}
```

- A field that no registered component covers is a new component in
  `src/components/form/`, registered in `app-form.ts` and built on
  `useFieldA11y` and `FieldFeedback`, so its label, help text, error,
  `aria-invalid` and `aria-describedby` work like the others.
- An array (rubric criteria, invitation rows) is `form.AppField
  mode="array"`, a stable `id` per row as the React key, `ArrayRowControls`
  and `useArrayEditing` (`src/components/form/array-controls.tsx`); split a
  row into a `withForm` part, as `src/components/dev-forms/rubric-editor.tsx`
  does.
- Read form state elsewhere in the form with `useStore(form.store, selector)`
  and a selector that returns a primitive.

## Rules to hold

- Every control has a visible label tied to it (the registered fields do
  this); help text is the `description`; never a placeholder as the label
  (WCAG 1.3.1, 3.3.2).
- A server refusal (a deadline passed, an unknown sample ID) is shown at the
  field it concerns, or at the top of the form with focus moved to it
  (`applyServerRefusal`, `form.FormErrors`), and announced (`role="alert"`
  or the toast).
- An irreversible submit (S6 lab report, D4 final grade) confirms with an
  `AlertDialog` that states what can no longer change.
- `form.SubmitButton` reflects `isSubmitting`, cannot double-submit and is
  never disabled only because the form is invalid.

## Tests

- **Schema unit tests:** every rule accepts the valid case and refuses each
  invalid case with its message, in the `en` and the `nl` locale.
- **Server function tests:** the validator rejects a crafted payload that
  bypasses the form; the role and ownership checks refuse other users.
- **E2E:** fill the form with the keyboard only, submit, see the result;
  submit invalid input and see each error by its label; axe finds zero
  WCAG 2.1 A/AA violations in both states, in light, dark and `nl`. Call
  `expectHydrated()` before typing into a server-rendered form.
- **Component tests** (`tests/unit/`, jsdom) for a new registered field:
  label, `aria-describedby` and the error by role, as
  `tests/unit/form-foundation.test.tsx` does.
