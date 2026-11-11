---
name: stack-decisions
description: "The eduLIMS stack as bootstrapped (commit 506a3b1): TanStack Start full SSR on Vite 8 + Nitro, TypeScript 7 native tsc, React 19, TanStack Router/Query/Form/Table, Tailwind 4, shadcn/ui radix-nova, Biome 2.6, Vitest 5, Kysely on PostgreSQL 18, better-auth with Entra ID or Keycloak, Node 26 LTS, pnpm 12"
metadata:
  type: project
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

The bootstrap settled the frontend and backend framework:

- **App:** TanStack Start, full SSR, on Vite 8 with Nitro; React 19;
  TanStack Router (file routes), Query (loaders with `ensureQueryData`),
  Form and Table v9.
- **UI:** Tailwind 4 and shadcn/ui, style `radix-nova`, lucide icons.
- **Language and tooling:** TypeScript 7 with the native `tsc`, Biome 2.6 for
  format and lint, Vitest 5 with v8 coverage (70% thresholds), Playwright with
  axe for e2e.
- **Data:** Kysely on PostgreSQL 18 (one server, two databases: eduLIMS and
  FerroEHR). Measurements in FerroEHR over openEHR REST and AQL. Kysely is
  confirmed over Drizzle (owner, 2026-11-11): better-auth's own PostgreSQL
  adapter is Kysely and migrations stay hand-reviewed; revisit Drizzle only
  once its 1.0 is stable.
- **Real PostgreSQL 18 everywhere:** development (`pnpm dev:db`, the
  `compose.dev.yaml` stack), unit tests (`edulims_test`, a rolled-back
  transaction per test) and e2e (`edulims_e2e`); PGlite was removed (owner:
  "build it directly on the proper postgres server").
- **Docs site:** Astro Starlight in `website/` on GitHub Pages at
  <https://edulims.eu>, English everywhere plus Dutch user guides; chosen over
  Ferro's mdBook for i18n, accessibility and the pnpm toolchain. No axe scan in
  its CI workflow (too slow); run `check:a11y` locally.
- **Auth:** better-auth with Microsoft Entra ID or Keycloak over OIDC (ADR 0010).
- **Runtime:** Node 26.13.0 LTS, pnpm 12.18.0, both pinned in `package.json`
  `devEngines` and `.node-version`; exact versions (`save-exact=true`).
- **Library skills:** pnpm 12 links the agent skills that TanStack Router,
  Start and Table ship into `.claude/skills/` as gitignored symlinks,
  approved in `pnpm-workspace.yaml` `permissions:`.

**Why:** owner choice for long-term maintainability and for AI
assistant support, made at the bootstrap.

**How to apply:** pin and verify every version on the registry when you add
it; answer framework questions from the linked skills and the docs MCP
servers, not from memory. A change to this list is an owner decision; record
it here.
