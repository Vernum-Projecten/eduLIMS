---
name: charts-tanstack
description: "Every chart is TanStack Charts (@tanstack/charts 1.5.0) through EduChart with an ariaLabel, a description, a table view, shape-plus-colour series and the brand chart palette; recharts and the shadcn chart are gone; owner 2026-11-11 (#59)"
metadata:
  type: project
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

- **Decision:** every chart and dashboard (the KPI dashboard D5, the Admin
  overview, later measurement views) uses TanStack Charts, one package
  `@tanstack/charts` with the React adapter at `@tanstack/charts/react`.
  `recharts` and `src/components/ui/chart.tsx` were removed (ADR 0016).
- **Foundation:** `EduChart` in `src/components/charts/` is the only way to
  render a chart; the rules are `.claude/rules/react-ui.md` §4. Helpers in
  `src/lib/charts/`: `sqrtRadiusScale`, `chartSeriesColor`,
  `chartTableRows`.
- **Palette:** `--edulims-chart-light-*` and `--edulims-chart-dark-*` in
  `assets/brand/tokens.css`, mirrored as `--chart-1` to `--chart-6` in
  `src/styles/app.css` and mapped onto `--ts-chart-*`;
  `scripts/checks/brand-contrast.sh` fails a chart colour under 3:1 on its
  background.
- **Learned:** the library renders SVG on the server and hydrates cleanly;
  `var(--…)` paints work in its SVG attributes; its default tooltip and tick
  formatting use the browser locale, so pass `format.ts` formatters
  explicitly; its tooltip is a `role="status"` element inside
  `.ts-chart-host`; its hit layer sits above the painted points, so e2e
  hovers by coordinates, not `locator.hover()`.
- **Example:** `/dev/charts` (fictional practicals), served only when
  `NODE_ENV` is not `production` (`src/server/dev-tools.ts`).

**Why:** owner decision on #59 and the TanStack epic #60: one library per job.

**How to apply:** a new chart composes `EduChart`; never import `Chart`
elsewhere or add another chart dependency; check the installed docs in
`node_modules/@tanstack/charts/docs/` before using an API.
