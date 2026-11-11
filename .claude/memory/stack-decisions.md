---
name: stack-decisions
description: "The eduLIMS stack as bootstrapped (commit 506a3b1): TanStack Start full SSR on Vite 8 + Nitro, TypeScript 7 native tsc, React 19, TanStack Router/Query/Form/Table, Tailwind 4, shadcn/ui radix-nova, Biome 2.6, Vitest 5, Kysely on PostgreSQL 18, better-auth with Entra ID, Node 26 LTS, pnpm 12"
metadata:
  type: project
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

The plan of approach left the frontend and backend framework open ("kies ik
in de ontwerpfase"). The bootstrap settled it:

- **App:** TanStack Start, full SSR, on Vite 8 with Nitro; React 19;
  TanStack Router (file routes), Query (loaders with `ensureQueryData`),
  Form and Table v9.
- **UI:** Tailwind 4 and shadcn/ui, style `radix-nova`, lucide icons.
- **Language and tooling:** TypeScript 7 with the native `tsc`, Biome 2.6 for
  format and lint, Vitest 5 with v8 coverage (70% thresholds), Playwright with
  axe for e2e.
- **Data:** Kysely on PostgreSQL 18 (one server, two databases: eduLIMS and
  FerroEHR). Measurements in FerroEHR over openEHR REST and AQL.
- **Auth:** better-auth with Microsoft Entra ID over OIDC.
- **Runtime:** Node 26.13.0 LTS, pnpm 12.18.0, both pinned in `package.json`
  `devEngines` and `.node-version`; exact versions (`save-exact=true`).
- **Library skills:** pnpm 12 links the agent skills that TanStack Router,
  Start and Table ship into `.claude/skills/` as gitignored symlinks,
  approved in `pnpm-workspace.yaml` `permissions:`.

**Why:** owner choice for maintainability in the CollabSpace and for AI
assistant support, made at the bootstrap.

**How to apply:** pin and verify every version on the registry when you add
it; answer framework questions from the linked skills and the docs MCP
servers, not from memory. A change to this list is an owner decision; record
it here.
