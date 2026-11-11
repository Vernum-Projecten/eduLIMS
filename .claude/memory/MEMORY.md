<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Memory index

Every learning that should outlive a session is a file here with a line in
this index ([[memory-lives-in-repo]]). Check for an existing file before
adding one, and update it instead of duplicating.

## Owner decisions

- [Requirements are a draft](requirements-are-draft.md): S/D/B IDs, NFRs,
  acceptance criteria and KPIs are under discussion; cite IDs, flag gaps and
  ask the owner, never invent or complete one; owner 2026-11-11
- [GitHub, not Azure DevOps](github-not-azure-devops.md): Issues, Actions,
  GHCR on Vernum-Projecten/eduLIMS instead of Azure Boards, Repos, Pipelines
  and ACR; owner 2026-11
- [No AI attribution](no-ai-attribution.md): no Co-Authored-By, no
  "Generated with", no robot emoji, no ai-assisted label anywhere, as in the
  Ferro family; hook-enforced
- [Merge gate and auto-merge](merge-gate-auto-merge.md): PR, merge queue,
  required `conclusion` check, 0 required approvals; arm
  `gh pr merge <n> --auto` on open; never `--admin`
- [Licence, SPDX and languages](spdx-and-languages.md): Apache-2.0, SPDX
  header `Ruben Talstra` on every hand-written file; everything English, UI
  text through the i18n layer with Dutch as the `nl` translation (ADR 0011)
- [Neutral project context](neutral-project-context.md): no people's names
  and no institution or course specifics; "an open-source LIMS for practical
  laboratory education"; owner 2026-11-11
- [Brand and UI](brand-and-ui.md): the Microplate mark; build from shadcn/ui
  components and blocks, user-friendly end to end; the language menu pattern
- [Supply-chain release age](supply-chain-release-age.md): pnpm
  `minimumReleaseAge: 1440`, strict; Dependabot cooldown 7 days

## Working with the owner

- [Owner uses Podman](owner-uses-podman.md): `podman compose`, fully
  qualified image names, never touch their running containers unasked
- [Env file workflow](env-file-workflow.md): never read or edit the local env
  file; update the example and end with "run `! pnpm env:sync`"; use a
  separate worktree while the owner runs `pnpm dev`

## Stack

- [Stack decisions](stack-decisions.md): TanStack Start full SSR on Vite 8 and
  Nitro, TypeScript 7 native tsc, React 19, shadcn/ui radix-nova, Biome 2.6,
  Vitest 5, Kysely on PostgreSQL 18, better-auth with Entra ID or Keycloak, Node 26 LTS,
  pnpm 12 with library skills linked into .claude/skills

## Family rules (carried from the Ferro repositories)

- [Memory lives in the repo](memory-lives-in-repo.md): tracked files here,
  never a per-user note
- [No personal data in requests](no-personal-data-in-requests.md): a neutral
  User-Agent and no owner contact in any call to an external service
