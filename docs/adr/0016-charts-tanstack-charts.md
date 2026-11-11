<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# 0016. Charts: TanStack Charts, through one accessible wrapper

- Status: Proposed
- Date: 2026-11-11
- Deciders: owner (decision on #59)

## Context and problem statement

eduLIMS needs charts for the KPI dashboard (D5), the Admin overview and,
later, measurement views. The shadcn/ui component set brought in `recharts`
and its `chart` component, unused so far. The rest of the stack is TanStack
(Start, Router, Query, Form, Table; epic #60), and every screen has to meet
WCAG 2.1 AA: a chart needs a name, keyboard access, meaning that does not rest
on colour alone, and its values available as text.

## Considered options

1. **recharts with the shadcn `chart` component**, as installed.
2. **TanStack Charts** (`@tanstack/charts`), with a thin eduLIMS wrapper.
3. **Hand-written SVG** per chart.

## Decision

Option 2. Every chart uses TanStack Charts 1.5.0 (one package; the React
adapter at `@tanstack/charts/react`) and renders through
`EduChart` in `src/components/charts/`. `recharts` and
`src/components/ui/chart.tsx` are removed, so there is one chart library.

`EduChart` gives every chart:

- a required, translated `ariaLabel` and a visible description linked to the
  chart with `aria-describedby`;
- a "View as table" toggle that shows the same rows as an HTML table with a
  caption and `th scope` (WCAG 2.1 SC 1.1.1, 1.3.1), from column definitions
  the caller passes;
- an HTML legend by shape and name, so series never differ by colour alone
  (SC 1.4.1, R-09);
- series colours from the theme tokens `--chart-1` to `--chart-6`
  (`src/styles/app.css`), mapped onto TanStack Charts' `--ts-chart-*`
  variables, with a light and a dark set in `assets/brand/tokens.css` that
  `scripts/checks/brand-contrast.sh` holds at 3:1 or more on their background
  (SC 1.4.11);
- numbers and dates formatted through `src/lib/i18n/format.ts` (the active
  locale, `APP_TIME_ZONE`), passed explicitly to axes and tooltips.

Charts render on the server: the React adapter emits the complete SVG at
`initialWidth` and adopts it after hydration, so a chart is visible before
JavaScript runs and needs no placeholder.

## Consequences

- One library to learn and keep up to date, with typed rows flowing into
  tooltips and focus callbacks without casts.
- Keyboard focus, the tooltip (a polite status region) and reduced motion
  come from the library; the table view and the legend are ours.
- TanStack Charts is young (1.x since 2026). Its compact scales cover linear,
  band, point, ordinal and time; a non-linear scale such as a square-root
  radius is a small helper in `src/lib/charts/` instead of a `d3-scale`
  dependency.
- The chart SVG's own axis rules and tick labels are drawn by the library
  with fixed opacities; they are `aria-hidden`, and the table view carries the
  values as text.

## Links

- TanStack Charts: <https://tanstack.com/charts/latest>
- WCAG 2.1 SC 1.1.1, 1.3.1, 1.4.1, 1.4.11: <https://www.w3.org/TR/WCAG21/>
- Issue #59, epic #60
