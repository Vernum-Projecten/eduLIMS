---
name: ui-gates
description: Runs the full quality-gate battery for a UI change in order (typecheck, Biome lint, unit tests with the 70% core coverage bar, production build, Playwright e2e with the axe WCAG 2.1 AA scan and the keyboard journeys) and reports PASS, FAIL or SKIPPED per gate. Use before committing any change under src/routes or src/components, when the user asks to "check the UI", or as the done-gate a ui-implementer task must pass.
allowed-tools: Bash, Read, Grep, Glob
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# /ui-gates

Run every gate a UI change must pass (`.claude/rules/react-ui.md`,
`testing.md`). Run the cheap gates first and stop at the first hard failure.

## The battery, in order

```bash
pnpm typecheck        # 1. tsc, the strict options of tsconfig.json
pnpm lint             # 2. Biome format and lint, no write
pnpm test:coverage    # 3. Vitest with the 70% core thresholds
pnpm build            # 4. the production SSR build (catches server-only leaks)
pnpm test:e2e         # 5. Playwright: every route's axe scan, keyboard journeys
```

Stage 5 needs the Compose test stack (the app, PostgreSQL 18, and a FerroEHR
or its stub) and the Playwright browsers. If it cannot run here, report
`SKIPPED(<reason>)` and say that CI's e2e job runs it and gates the merge; a
skip is never a pass.

## What to check by hand (no tool can)

- Every new string a user reads is Dutch, and every new route has a Dutch
  `title` (WCAG 2.4.2).
- Meaning is never carried by colour alone (1.4.1): look at each new status,
  badge, KPI signal and validation state.
- The screen at 320 px wide and at 200% zoom scrolls only vertically
  (1.4.10).
- The data on screen is the role's own data: a student page shows no other
  student; an average shows only from 5 assessments (`auth-security.md`).

## Report

One line per gate: PASS, FAIL, or SKIPPED(reason), with the failing output
quoted verbatim on a FAIL, then the hand checks with a finding or "ok" each.
Never mark a gate you did not run as green. A FAIL is never fixed by
weakening the gate (excluding an axe rule, deleting a test, lowering a
threshold, adding a `biome-ignore` without a reason): fix the code.
