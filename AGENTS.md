<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# AGENTS.md

This repository's working discipline for coding agents is **`CLAUDE.md`**,
with the scoped rules under `.claude/rules/`. Read both before you change
anything; they apply to every agent, whatever tool runs it.

The short version:

- eduLIMS is a TanStack Start (SSR) app in strict TypeScript 7 with
  shadcn/ui, Kysely on PostgreSQL 18, better-auth with Entra ID or Keycloak, and
  FerroEHR (openEHR) for measurements.
- Gate: `pnpm check` (typecheck, Biome lint, Vitest); `pnpm test:e2e` for UI
  (Playwright with axe, WCAG 2.1 AA).
- The requirements in `docs/requirements.md` are a working draft: cite their
  IDs, and ask the owner when one is unclear or missing instead of inventing
  it.
- Never real personal data; only pseudonyms in FerroEHR; role and ownership
  checks in every server function.
- Everything in English, including UI copy; all user-visible text goes
  through the i18n layer (English source, Dutch `nl` translation; ADR 0011);
  an SPDX header (`Ruben Talstra`, `Apache-2.0`) on every hand-written file.
- Conventional branches and commits, a PR with `Closes #N` and auto-merge
  armed (`gh pr merge <n> --auto`), and no AI attribution anywhere.
