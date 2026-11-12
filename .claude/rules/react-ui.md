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
share one app: the Student portal, the Teacher portal and the Admin portal.
The quality requirement is **WCAG 2.1 level AA**, checked with axe and a
keyboard pass (Q-ACC-1). All UI text goes through the i18n layer (English
source, Dutch translation); never hard-code a user-visible string
(`writing-style.md`, ADR 0011). The root document's `lang` follows the active
locale (`en` or `nl`).

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

## 2. Forms: `useAppForm` + shadcn Field + Zod

Every form is built on the one foundation in `src/components/form/` (#61)
and the `/new-form` skill; `/dev/forms` shows every piece on fictional data.
Never call `useForm` or wire `Field`, `FieldLabel` and `FieldError` by hand
in a feature component.

- **One hook:** `useAppForm` from `@/components/form/app-form`
  (`createFormHook`). `withForm` splits a large form into typed parts
  (`formOptions` shared by the form and its parts).
- **One Zod schema per form**, shared with the server function's
  `.validator()`, so client and server refuse the same input. Validate it
  with `validationLogic: revalidateLogic()` and
  `validators: { onDynamic: schema }`: nothing shows before the first submit,
  then each change revalidates. Plain `onSubmit` loses an error when the
  field only loses focus; use `onChange: schema` only on a small form that
  should validate while typing (a form-level `onChange` schema renders every
  invalid field on each keystroke).
- **Fields are registered components:** `form.AppField name="…"` (the name is
  typed from the default values, nested paths too, such as
  `criteria[2].levels[0].points`) renders `field.TextField`,
  `TextareaField`, `NumberField` (`NaN` for an empty entry, which the schema
  refuses), `SelectField`, `CheckboxField`, `CheckboxGroupField`,
  `RadioGroupField`, `SwitchField`, `DateField` (a `YYYY-MM-DD` value on the
  localised `Calendar`) or `EmailListField` (pasted addresses, checked with
  `emailListSchema`). Each takes a translated `label` and an optional
  `description`, and wires the label, `aria-invalid`, `aria-describedby`
  (help text and error) and the error itself; an error shows once the field
  is touched, and a submit touches every field.
- **Form components:** inside `form.AppForm`, `form.SubmitButton`
  (subscribes to `isSubmitting` only; spinner, no double submit, focus to the
  first invalid control after a refused submit; never disabled while the form
  is merely invalid, which would hide the reason) and `form.FormErrors` (the
  form-level refusal at the top, focused when it appears).
- **Async checks** ("this sample ID is already registered") are a field's
  `onChangeAsync` with `onChangeAsyncDebounceMs`, calling a GET server
  function through `useServerFn` with the validator's `signal`; the field
  shows "Checking…" in a live region while it runs.
- **Server refusals** map back with `applyServerRefusal(formApi, { fields,
  form })`: a translated message at the field it concerns, or at the top.
  A field refusal stays until that field changes; a form refusal stays,
  focused, until a field changes. A new submit clears both, so an unchanged
  value can be sent again; a blur clears neither. `useAppForm` wraps the
  form's validation logic in `keepServerRefusals` for this, so never call
  TanStack's `useForm` directly.
- **Arrays** use `form.AppField name="…" mode="array"` with `pushValue`,
  `removeValue` and `moveValue`; every row has a stable `id` as its React
  key, `ArrayRowControls` (move up, move down, remove, named after the row)
  and `useArrayEditing`, which announces each change in a live region and
  keeps focus on the moved row (WCAG 2.1.1, 2.4.3, 4.1.3). Row names in a
  callback are read with `form.getFieldValue`, since an array field renders
  only on a change of its structure.
- **Granular subscriptions:** read form state in a component with
  `useStore(form.store, selector)` or `form.Subscribe` and a selector that
  returns a primitive, so a keystroke renders only its own field
  (`tests/unit/form-foundation.test.tsx` proves it).
- Every control has a visible label (WCAG 1.3.1, 3.3.2); a placeholder is
  never the label. Validation messages come from the i18n layer and are
  specific and actionable ("Sample ID LS-0042 does not exist in this
  practical", never "Invalid input").

## 3. Accessibility (WCAG 2.1 AA)

Hold every screen to these; the `ui-reviewer` agent checks them and the e2e
suite runs axe on every route (`testing.md`).

- **Keyboard:** every action works with the keyboard alone, in a logical tab
  order, with a visible focus ring (2.1.1, 2.4.3, 2.4.7). No `onClick` on a
  `div`; use a `button` or a link.
- **Structure:** one `h1` per page, headings in order, landmarks (`header`,
  `nav`, `main`), a skip link to `main` (1.3.1, 2.4.1). Every route sets a
  translated `title` through its `head()` (2.4.2).
- **Colour:** text contrast at least 4.5:1, large text and UI components at
  least 3:1 (1.4.3, 1.4.11). **Never carry meaning by colour alone** (1.4.1):
  a KPI signal, a rejected well or an out-of-range measurement shows an icon
  and text as well (R-09, "a colour-blind or visually impaired user").
- **Tables:** real `<th>` headers with `scope`, a caption or `aria-label`; the
  96-well plate view is a table with row and column headers, not a grid of
  divs.
- **Status and errors:** dynamic results (an upload verdict, a saved grade)
  are announced through a live region (`role="status"` or the toast), and an
  error is identified in text (3.3.1).
- **Reflow and zoom:** usable at 320 CSS px wide and at 200% zoom without
  horizontal scrolling (1.4.4, 1.4.10).
- **Motion:** respect `prefers-reduced-motion` for animations.

## 4. Charts: TanStack Charts through `EduChart`

Every chart and dashboard uses **TanStack Charts** (`@tanstack/charts`, ADR
0016) and renders through `EduChart` (`src/components/charts/edu-chart.tsx`),
never `Chart` directly and never another chart library. Learn the API from
the installed package (`node_modules/@tanstack/charts/docs/`, its type
definitions) and <https://tanstack.com/charts/latest>, never from memory.

- **Name and description:** a translated `ariaLabel` (what the chart shows)
  and a `description` (how to read it, including the arrow keys), which
  `EduChart` shows and links with `aria-describedby`.
- **Table view:** pass `table` (caption, the rows, column definitions with
  formatted cells, a row key). "View as table" shows the same rows with
  `th scope`; essential values never live only in a tooltip (SC 1.1.1,
  1.3.1).
- **Never colour alone:** give each series its own shape (`dot`, `hexagon`,
  a ring) or a direct label, and pass `legend` with the same shape and name
  (SC 1.4.1, R-09). A threshold or norm line carries text.
- **Colour:** paint series with `chartSeriesColor(i)` (`src/lib/charts/`),
  which reads the theme tokens `--chart-1` to `--chart-6`; never a hex in a
  definition. The palette holds 3:1 or more on its background, checked by
  `scripts/checks/brand-contrast.sh`; a new colour goes into
  `assets/brand/tokens.css` first.
- **Formatting:** axis ticks and tooltip rows format through
  `src/lib/i18n/format.ts` (active locale, `APP_TIME_ZONE`), passed
  explicitly; the library's default formatting follows the browser locale,
  which can differ from the server's.
- **Typed rows:** keep the original row as the datum and read it in tooltip
  `content` and `onFocusChange` (`point.datum`), without casts.
- **SSR:** charts render on the server; give a fixed `height` and keep the
  definition deterministic (no clock, no random, no `window`). Memoize a
  definition that captures labels on the locale.
- **Point size:** an explicit square-root radius scale (`sqrtRadiusScale`),
  so the area, not the radius, follows the value.
- **Data** comes from the route loader like any other screen (§5); a chart
  never fetches or filters by role.

## 5. Data on screen follows the role

- A component renders what its loader returned and nothing more. Never fetch
  "all results" and filter by role in the component; the server function
  filters (`auth-security.md`, S7, D3).
- A student sees their own grade next to the class and practical average; an
  average shows only from 5 assessments upward (R-03, "an average reveals an
  individual grade").
- No name or student number of a subject from FerroEHR appears anywhere;
  measurements show the sample ID.

## 6. Performance

Pages load within 2 seconds (requirements, "Performance"). Load data in the
route loader so SSR sends it with the HTML, paginate tables on the server,
and keep client-only libraries out of the critical path.
