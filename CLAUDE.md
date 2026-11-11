<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# CLAUDE.md

**eduLIMS** is an open-source laboratory information management system (LIMS)
for practical laboratory education. Students register samples, measure on the
Abbott Afinion 2 and the BioTek Epoch 2, upload the Gen5 Excel export, check
their results and hand in a lab report; teachers set up practicals with a
protocol, a deadline and a rubric, assess with the rubric, and read a KPI
dashboard; administrators manage users, roles, classes, analysers and the
integrations. One web app serves three portals: the **Student portal**
(`/student`), the **Teacher portal** (`/teacher`) and the **Admin portal**
(`/admin`), for the roles `student`, `teacher` and `admin`.

Two databases hold the data, on one PostgreSQL 18 server: the **eduLIMS
database** for everything educational (users, practicals, sample IDs, lab
reports, assessments, logs) and **FerroEHR**, an openEHR CDR, for the
measurements as compositions on the `eduLIMS-lab` template. Afinion results
arrive as HL7 v2 through **FerroBRIDGE**; Epoch results arrive through the
Excel upload, which eduLIMS writes to FerroEHR over openEHR REST. eduLIMS
reads them back with AQL. Sign-in is OpenID Connect through Microsoft Entra ID or Keycloak (ADR 0010).
Everything runs as containers with Docker Compose.

This file is the working discipline. The design is `docs/architecture.md`;
the current requirements draft is `docs/requirements.md`. Write all prose to
`.claude/rules/writing-style.md`.

## Repo map

- `src/routes/`: TanStack Router file routes. A pathless `_authed` layout
  guards sign-in; one layout per portal (`student`, `teacher`, `admin`)
  guards the role. `src/routeTree.gen.ts` is generated: never edit it.
- `src/components/`: React components. `ui/` holds the shadcn/ui primitives
  the CLI adds; `<area>/` holds the feature components that compose them.
- `src/server/`: everything that runs only on the server. Server functions
  per area (`src/server/<area>/functions.ts` with `queries.ts` and
  `schemas.ts`), the database (`db/`: the Kysely instance, `migrations/`,
  the generated types), auth (`auth/`: better-auth and the session and role
  middleware), the FerroEHR client (`openehr/`), the Gen5 parser (`upload/`).
- `src/lib/`: isomorphic helpers (`utils.ts` with `cn`), pure domain logic
  that both sides import (grading, KPIs, well positions).
- `src/styles/app.css`: Tailwind 4 and the shadcn theme tokens.
- `tests/unit/`: Vitest unit and data tests (colocated `*.test.ts(x)` under
  `src/` run too). `tests/e2e/`: Playwright journeys with the axe scan.
  `tests/integration/`: tests against the Compose stack. `tests/fixtures/`:
  the fixed pseudonymised test set.
- `messages/`: the i18n message catalogues (`en` is the source, `nl` the
  Dutch translation).
- `docker/`: the Compose stack (eduLIMS, PostgreSQL 18, FerroEHR,
  FerroBRIDGE) and its configuration.
- `docs/`: `requirements.md` (the draft), `architecture.md`, `ci-cd.md`,
  `release.md`, the operator and handover guides.
- `.github/`: workflows (CI, release), Dependabot, templates.
- `scripts/`: repository helpers, among them `scripts/gh/` (issue fields,
  relationships, the board) and `scripts/release/`.
- `.claude/`: this working discipline (index below).

## Tech stack (pinned in `package.json`)

Exact versions everywhere (`.npmrc` `save-exact=true`); verify a version on
the npm registry at the moment you add it, never from memory.

- **App:** TanStack Start (full SSR) on Vite 8 and Nitro; React 19; TanStack
  Router, Query, Form and Table v9.
- **UI:** Tailwind 4, shadcn/ui (`radix-nova`, `components.json`), lucide
  icons. Forms are shadcn `Field` plus TanStack Form plus Zod.
- **Language and tooling:** TypeScript 7 (native `tsc`) with the strict
  options in `tsconfig.json`; Biome 2.6 for formatting and lint.
- **Data:** Kysely on PostgreSQL 18; kysely-codegen for the `Database` types.
- **Auth:** better-auth with Microsoft Entra ID and/or Keycloak (OIDC,
  authorization code with PKCE); roles mapped from an ID-token claim
  (`OIDC_ROLE_CLAIM`, `OIDC_ROLE_MAP`), see ADR 0010.
- **Integrations:** openEHR REST API (ITS-REST 1.1.0) and AQL 1.1 to FerroEHR;
  HL7 v2 over MLLP into FerroBRIDGE.
- **Tests:** Vitest 5 with v8 coverage, Testing Library, Playwright with
  `@axe-core/playwright`.
- **Runtime:** Node 26.13.0 LTS and pnpm 12.18.0, pinned in `devEngines` and
  `.node-version`.
- **Delivery:** GitHub Actions, images on GHCR, Docker Compose on one host.

## Build and test

```bash
pnpm install              # exact lockfile; CI uses --frozen-lockfile
pnpm dev:db               # PostgreSQL 18 + Keycloak (podman compose, else docker compose) -f compose.dev.yaml up -d --wait
pnpm dev:db:stop          # stop the dev stack, keep its data (dev:db:logs follows the logs)
pnpm dev                  # dev server on :3000, regenerates the route tree
pnpm build && pnpm start  # production SSR build and server
pnpm typecheck            # tsc --noEmit
pnpm lint                 # biome check (no write)
pnpm fix                  # biome check --write
pnpm format               # biome format --write
pnpm test                 # vitest run (needs the dev stack: database edulims_test)
pnpm test:coverage        # with the 70% core thresholds
pnpm test:e2e             # Playwright + axe (needs the dev stack: database edulims_e2e)
pnpm db:migrate           # apply Kysely migrations
pnpm db:seed              # the dev-login users (idempotent)
pnpm db:reset             # empty the LOCAL dev database, then migrate and seed
pnpm db:generate-types    # regenerate the Kysely Database types
pnpm check                # the local gate: typecheck, lint, test
```

`/ui-gates` runs the full battery for a UI change.

## IMPORTANT hard rules

- **The requirements are a working draft.** `docs/requirements.md` (S1 to
  S9, D1 to D8, B1 to B4, the quality requirements, the acceptance criteria,
  the KPIs and their norms) is still under discussion with the product owner.
  Cite requirement IDs in issues, tests and PRs. When a requirement is
  unclear, missing, or conflicts with what you are building, **flag it and ask
  the owner** (on the issue, in the plan, in your report). Never invent a
  requirement, never "complete" one, and never pick a number the draft does
  not state. An owner decision on an issue is newer than the document.
- **The external specifications are authoritative in their domain:** the
  openEHR ITS-REST 1.1.0 and AQL specifications and the CKM archetypes for
  FerroEHR, HL7 v2 for the Afinion messages (`.claude/rules/integration.md`),
  WCAG 2.1 AA for accessibility, the OWASP Top 10:2025 for security. Read the
  section before you implement it; cite it in the PR.
- **Privacy: never real personal data.** Code, fixtures, seeds, logs,
  screenshots, issues and PRs use the fixed pseudonymised test set only. Only
  pseudonyms reach FerroEHR: no name, student number or e-mail address in a
  composition or an AQL query. Logs carry ids, never names, grades or tokens.
- **Role-scoped access is enforced on the server.** Every server function and
  server route checks the session, the role and the ownership (in the SQL
  query) before it reads data. A student sees only their own work (S7); a
  teacher only their own practicals (D3). Route guards are navigation, never
  the security boundary. Every role-scoped function has negative tests per
  role (`.claude/rules/auth-security.md`).
- **WCAG 2.1 AA** on every screen: keyboard operable, labelled, never colour
  alone, axe-clean (`.claude/rules/react-ui.md`).
- **Server-only code stays on the server.** The database, secrets, FerroEHR
  and the session live under `src/server/` behind `createServerFn` with Zod
  input validation. No secret in a `VITE_` variable or client code.
- **TypeScript at its strictest:** no `any`, no non-null `!`, no relaxed
  `tsconfig` or `biome.json` to get a change through
  (`.claude/rules/typescript-style.md`).
- **Never edit generated files:** `src/routeTree.gen.ts`, the Kysely types,
  `pnpm-lock.yaml`, the pnpm-linked skills under `.claude/skills/`.
- **Never commit or read `.env` files.** `.env.example` lists the names with
  empty values.
- **Never weaken, skip, or delete a test** to make a build pass; never lower
  the coverage bar or exclude an axe rule.
- **SPDX header on every hand-written file:**
  `SPDX-FileCopyrightText: Ruben Talstra` and
  `SPDX-License-Identifier: Apache-2.0`, in the file's comment syntax.
- **Everything is English: docs, code, comments, commits and UI copy.** All
  user-visible text goes through the i18n layer (English source, Dutch
  translation in the `nl` locale); never hard-code a user-visible string
  (ADR 0011).
- **Branches use conventional types** (`feat/`, `fix/`, `chore/`, `docs/`,
  `refactor/`, `perf/`, `test/`, `ci/`, `build/`, `release/`), and commits
  use conventional commit subjects.
- **NEVER add AI or Claude attribution** to commits, PRs, issues, releases or
  code: no `Co-Authored-By`, no "Generated with", no robot emoji, no
  `ai-assisted` label. The hook blocks it.

## Definition of Done

From the test strategy, with the merge gate the owner chose. A user story is done when all of these hold:

- [ ] The acceptance criterion of the requirement is met and shown in a test
  or a demo (as the criterion stands in the current draft or in the owner's
  decision on the issue).
- [ ] The new code has unit tests, `pnpm check` is green, the core holds 70%
  coverage, and the CI `conclusion` check is green.
- [ ] The pull request is reviewed by convention, and `security-reviewer` and
  `ui-reviewer` have no open blockers. The branch rule itself requires zero
  approvals and auto-merge lands a green PR; review is a convention, not a
  gate.
- [ ] The change ran in the Compose test environment.
- [ ] `docs/` is updated when the architecture changed.
- [ ] A user-visible change has a `changelog.d/` fragment.

## Issue and PR workflow

The tracker is GitHub Issues on `Vernum-Projecten/eduLIMS` (ADR 0002).
The open issue list is the worklist (`.claude/rules/issue-workflow.md`). An
issue carries a native type (`Task`, `Bug`, `Feature`), a priority, a
`Requirement:` line and `## Acceptance criteria`. Read one with
`gh issue view <n> --json title,body,comments`, never `--comments`.

1. `/next-task` picks the issue and writes the plan; the issue moves to
   `In Progress` on the board (`scripts/gh/project.sh`).
2. Branch from `origin/HEAD` as `<type>/<slug>`; build typed, tested
   increments; record progress on the issue.
3. Open the PR with `Closes #<n>` (one keyword per issue) and arm auto-merge
   at once: `gh pr merge <n> --auto`. `main` merges through the merge queue;
   `conclusion` is the one required check. Never `--admin`.
4. `/phase-done` verifies the Definition of Done and writes the close
   narrative.

New work found en route is filed and linked with `scripts/gh/rel.sh` (never a
prose "see also") and fixed before the next unit starts. The SessionStart hook
prints the open issues with `<Type/Priority>` after each title.

## Working discipline (`.claude/`)

Path-scoped rules load when you read files in their scope; the rest apply
always. Read the relevant one before working in an area.

- `rules/writing-style.md`: plain prose, no AI tells, English everywhere,
  Dutch only as the `nl` translation.
- `rules/typescript-style.md`, `reliability.md`, `comments.md`,
  `testing.md`: the engineering discipline (strict TS7, Biome, server-only
  code, fail loud, TSDoc budgets, the test levels and the 70% bar).
- `rules/tanstack.md`: routes, loaders with `ensureQueryData`, server
  functions, SSR hygiene.
- `rules/react-ui.md`: shadcn/ui, the TanStack Form pattern, WCAG 2.1 AA.
- `rules/auth-security.md`: better-auth with Entra ID and Keycloak, roles and ownership,
  privacy, the OWASP checklist, uploads.
- `rules/database.md`: Kysely, PostgreSQL 18, migrations, schema rules.
- `rules/integration.md`: FerroEHR (openEHR REST and AQL), FerroBRIDGE (HL7
  v2), the Gen5 upload.
- `rules/ci-cd.md`, `ai-code-review.md`: pinned actions, zizmor, SLSA L3,
  the merge gate, machine review as advice.
- `rules/changelog.md`: `changelog.d/` fragments.
- `rules/issue-workflow.md`, `issue-relationships.md`, `project-board.md`:
  the tracker.
- **Skills:** `/next-task`, `/phase-done`, `/phase-status` (the issue loop),
  `/requirement-lookup` (the draft requirement with its gaps flagged),
  `/new-route`, `/new-form`, `/db-migration` (scaffolds), `/ui-gates` (the
  UI battery), `/release` (the cut, pointing at `docs/release.md`).
- **Library skills:** pnpm 12 links the agent skills that TanStack Router,
  Start and Table ship (`react-start`, `react-router`, `router-query`,
  `table-state`, `getting-started`, the migration guides) into
  `.claude/skills/` as symlinks into `node_modules`. They match the installed
  versions, so prefer them over memory for API questions. pnpm writes their
  names into `.claude/skills/.gitignore` (between `# pnpm` markers; leave that
  file to pnpm), and a package may link skills only when
  `pnpm-workspace.yaml` approves it under `permissions:`
  (`"<package>": { skills: true }`). Project skills live beside them in their
  own directories and are committed.
- **Agents** (all on Opus): `implementer`, `ui-implementer`, `test-writer`
  (build); `ui-reviewer`, `security-reviewer` (read-only review);
  `requirements-researcher` (read-only research into the draft requirements
  and the specifications).
- **Hooks** (`.claude/settings.json`): `no_attribution_guard.sh`,
  `block_dangerous.sh`, `conflict_markers_guard.sh` and `env_guard.sh` before
  every shell command; `env_guard.sh` and `generated_file_guard.sh` before
  file reads and edits; `biome_check.sh` (Biome on the edited file, shellcheck
  on scripts) and `versions_guard.sh` (exact pins in `package.json`) after
  every edit; `session_start_issues.sh` at session start.
- **Memory:** `.claude/memory/` holds the owner decisions and learnings,
  tracked and shared; the index is imported below.

## MCP servers (`.mcp.json`)

Approved for the project in `.claude/settings.json` (`enabledMcpjsonServers`;
Claude Code still asks once per server in a folder you have not trusted).
Secrets come from your shell environment, never from a committed file.

| Server | Purpose | Needs |
|---|---|---|
| `shadcn` | Browse, search and add shadcn/ui components and registry items (<https://ui.shadcn.com/docs/registry/mcp>); runs the pinned `shadcn` package through `pnpm exec` | nothing |
| `playwright` | Drive a browser against `pnpm dev` to check a screen, its keyboard path and its accessibility tree (`@playwright/mcp`, isolated profile) | nothing; the browsers install on first use |
| `tanstack` | The official TanStack docs server (<https://tanstack.com/api/mcp>): current docs for Start, Router, Query, Form and Table | a one-time OAuth sign-in with a tanstack.com account (`/mcp` in Claude Code) |
| `better-auth` | The official Better Auth docs server (<https://mcp.better-auth.com/mcp>) | nothing |
| `context7` | Version-specific library docs (Kysely, Zod, Vite, Vitest, Playwright, Tailwind) from Context7 (<https://mcp.context7.com/mcp>) | nothing (rate-limited without a key) |
| `postgres` | Inspect the local dev database (tables, columns, plans) with Google's MCP Toolbox prebuilt PostgreSQL tools (`@toolbox-sdk/server`) | the container dev stack running (`compose.dev.yaml` creates the read-only role `edulims_readonly`; its public dev password is the default, override with `EDULIMS_MCP_PG*`); connect as the read-only role `edulims_readonly` |

The `postgres` server can run any SQL the role allows, so it connects only to
the local Compose database and only as a role with `SELECT` rights and
`default_transaction_read_only = on`; never point it at a shared or
production database. The variable names avoid `GITHUB_TOKEN` and similar
credential names on purpose: Claude Code blanks those in a remote server's
headers.

## References

- `docs/requirements.md`: the requirements draft (MoSCoW, acceptance
  criteria, quality requirements, risks, KPIs).
- `docs/architecture.md`: the design (portals, data split, integrations,
  platform).
- `docs/ci-cd.md`, `docs/release.md`: the pipeline and the release cut.
- openEHR ITS-REST 1.1.0:
  <https://specifications.openehr.org/releases/ITS-REST/Release-1.1.0>
- AQL 1.1.0: <https://specifications.openehr.org/releases/QUERY/Release-1.1.0/AQL.html>
- WCAG 2.1: <https://www.w3.org/TR/WCAG21/>
- OWASP Top 10:2025: <https://owasp.org/Top10/2025/>

@.claude/memory/MEMORY.md
