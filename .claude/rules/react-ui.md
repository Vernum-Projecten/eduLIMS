---
paths:
  - "src/components/**"
  - "src/routes/**/*.tsx"
  - "src/styles/**"
  - "components.json"
  - "tests/e2e/**"
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# React UI: shadcn/ui, TanStack Form, WCAG 2.1 AA

The UI is React 19 on TanStack Start, styled with Tailwind 4 and built from
shadcn/ui components (style `radix-nova`, `components.json`). Three portals
share one app: Studentportaal, Docentportaal and Beheerportaal. The quality
requirement is **WCAG 2.1 level AA**, checked with axe and a keyboard pass
(requirements analysis, "Toegankelijkheid"). Every string a user reads is
Dutch (`writing-style.md`); the root document sets `lang="nl"`.

## 1. shadcn/ui owns the primitives

- **Add a component with the CLI**, never by hand-copying:
  `pnpm exec shadcn add <name>` (or through the `shadcn` MCP server). The
  component lands in `src/components/ui/`. Read the docs page of the component
  first (<https://ui.shadcn.com/docs/components>).
- **Compose, do not fork.** Feature components in `src/components/<area>/`
  wrap the `ui/` primitives. Edit a file in `src/components/ui/` only for a
  defect or an accessibility fix, and say so in the PR.
- **Use the primitive that exists** before building one: `Table` with
  TanStack Table for data grids, `Dialog`/`AlertDialog` for confirmation (the
  irreversible submit of S6 confirms with an `AlertDialog`), `Field` for form
  fields, `Badge` for statuses, `Sonner` for toasts, `Skeleton` for loading.
- **Styling is Tailwind utility classes and the theme tokens** in
  `src/styles/app.css` (`bg-background`, `text-muted-foreground`,
  `text-destructive`). No inline `style`, no hex colours in components, no new
  CSS file per component. `cn()` from `@/lib/utils` merges classes.
- **Icons** come from `lucide-react` and are `aria-hidden` unless they are the
  only content of a control, which then carries an `aria-label`.

## 2. Forms: shadcn Field + TanStack Form + Zod

Every form follows the shadcn TanStack Form guide
(<https://ui.shadcn.com/docs/forms/tanstack-form>) and the `/new-form` skill:

- One Zod schema per form, shared with the server function's `.validator()`,
  so client and server reject the same input.
- `useForm({ defaultValues, validators: { onSubmit: schema }, onSubmit })`;
  the `<form>` handler calls `e.preventDefault()` then `form.handleSubmit()`.
- Each field renders through `form.Field` inside `<FieldGroup>`:
  `const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid`,
  `<Field data-invalid={isInvalid}>`, `<FieldLabel htmlFor={field.name}>`, the
  control with `id={field.name}`, `name={field.name}`, `value`, `onBlur`,
  `onChange` and `aria-invalid={isInvalid}`, then
  `{isInvalid && <FieldError errors={field.state.meta.errors} />}`.
- Every control has a visible label (WCAG 1.3.1, 3.3.2); a placeholder is
  never the label. Help text is a `FieldDescription`.
- Validation messages are Dutch, specific and actionable ("Monster-ID
  LS-0042 bestaat niet in dit practicum", never "Ongeldige invoer"). The
  server's refusal is rendered next to the field it concerns, or at the top of
  the form with focus moved to it.
- The submit button shows the pending state (`form.state.isSubmitting`) and
  cannot double-submit.

## 3. Accessibility (WCAG 2.1 AA)

Hold every screen to these; the `ui-reviewer` agent checks them and the e2e
suite runs axe on every route (`testing.md`).

- **Keyboard:** every action works with the keyboard alone, in a logical tab
  order, with a visible focus ring (2.1.1, 2.4.3, 2.4.7). No `onClick` on a
  `div`; use a `button` or a link.
- **Structure:** one `h1` per page, headings in order, landmarks (`header`,
  `nav`, `main`), a skip link to `main` (1.3.1, 2.4.1). Every route sets a
  Dutch `title` through its `head()` (2.4.2).
- **Colour:** text contrast at least 4.5:1, large text and UI components at
  least 3:1 (1.4.3, 1.4.11). **Never carry meaning by colour alone** (1.4.1):
  a KPI signal, a rejected well or an out-of-range measurement shows an icon
  and text as well (risk analysis, "kleurenblinde of slechtziende
  gebruiker").
- **Tables:** real `<th>` headers with `scope`, a caption or `aria-label`; the
  96-well plate view is a table with row and column headers, not a grid of
  divs.
- **Status and errors:** dynamic results (an upload verdict, a saved grade)
  are announced through a live region (`role="status"` or the toast), and an
  error is identified in text (3.3.1).
- **Reflow and zoom:** usable at 320 CSS px wide and at 200% zoom without
  horizontal scrolling (1.4.4, 1.4.10).
- **Motion:** respect `prefers-reduced-motion` for animations.

## 4. Data on screen follows the role

- A component renders what its loader returned and nothing more. Never fetch
  "all results" and filter by role in the component; the server function
  filters (`auth-security.md`, S7, D3).
- A student sees their own grade next to the class and practicum average; an
  average shows only from 5 assessments upward (risk analysis, "gemiddelde
  verraadt een individueel cijfer").
- No name or student number of a subject from FerroEHR appears anywhere;
  measurements show the monster-ID.

## 5. Performance

Pages load within 2 seconds (requirements, "Performance"). Load data in the
route loader so SSR sends it with the HTML, paginate tables on the server,
and keep client-only libraries out of the critical path.
