<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Contributing to eduLIMS

eduLIMS is an open-source laboratory information management system (LIMS) for
practical laboratory education. The design is recorded in
[`docs/architecture.md`](docs/architecture.md) and the draft requirements, with
stable IDs, in [`docs/requirements.md`](docs/requirements.md). The working
rules for people and AI sessions are in [`CLAUDE.md`](CLAUDE.md). Read them
before you make a change. The published documentation is at
<https://edulims.eu/>.

## Setup

You need Node.js 26.13.0, pnpm 12.18.0 and a container engine with Compose:
Docker, or Podman with `podman compose` (every `docker compose` command below
works the same as `podman compose`). Without one, `pnpm dev:db` runs an
embedded PostgreSQL instead. The
`devEngines` field in `package.json` fails the install on any other runtime
or package manager version.

```sh
docker compose -f compose.dev.yaml up -d
pnpm install
pnpm db:migrate
pnpm dev
```

The development database only ever holds the pseudonymised test set. Never
load real names, student numbers or grades into it.

## Local gates

The local gates mirror CI:

```sh
pnpm typecheck        # TypeScript 7 (tsc --noEmit)
pnpm lint             # Biome lint and format check
pnpm test             # Vitest unit and data tests
pnpm test:coverage    # coverage; the core stays at 70% or more (Q-MAINT-1)
pnpm check            # the three gates above in one run
```

Browser and accessibility tests run with Playwright and axe. CI runs them on
every pull request; [`docs/test-strategy.md`](docs/test-strategy.md) lists
what each test level covers.

## Work loop

1. Pick an issue. Every feature issue names its requirement ID (for example
   `S4` or `Q-SEC-1`) and lists its acceptance criteria.
2. Branch from `main` with a conventional prefix: `feat/<slug>`,
   `fix/<slug>`, `docs/<slug>`, `chore/<slug>`, `refactor/<slug>`,
   `test/<slug>`, `ci/<slug>`, `build/<slug>`.
3. Commit with [Conventional Commits](https://www.conventionalcommits.org/)
   messages (`feat(upload): validate well positions`). A commit message
   describes the change only.
4. Open a pull request with `Closes #N` for each issue it finishes.
5. The pull request merges through the merge queue once CI is green.

## Merge rules

- `main` only changes through a pull request and the merge queue.
- Every required CI check must pass. No approval is required by the branch
  rules; by convention a reviewer looks at every pull request, and an
  open review comment is resolved before merging.
- Never weaken, skip or delete a test to make a build pass.
- Work is done when it meets the
  [Definition of Done](docs/test-strategy.md#definition-of-done).

## Attribution

Do not add AI or assistant attribution anywhere: no co-author trailers, no
"generated with" lines in commits, pull requests, issues or code. The
policy and its reasons are in [`AI_STATEMENT.md`](AI_STATEMENT.md) and
[ADR 0009](docs/adr/0009-no-ai-attribution-human-review.md).

## Writing

Write everything in English: prose, code, comments, commits and UI copy. All
user-visible text goes through the i18n layer (English source, Dutch
translation); never hard-code a user-visible string (ADR 0011). Write plainly. Address the reader as "you", use active
voice and present tense, and keep sentences short. Avoid em dashes,
decorative lists of three, and buzzwords such as "robust" or "seamless".

Hand-written files start with an SPDX header:

```ts
// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0
```

Markdown uses the same two lines as HTML comments. Generated and third-party
files are covered by [`REUSE.toml`](REUSE.toml) instead.

## Architecture changes

A change that alters the architecture also updates
[`docs/architecture.md`](docs/architecture.md), adds or supersedes a record in
[`docs/adr/`](docs/adr/README.md).

## Security

Report vulnerabilities privately; see [`SECURITY.md`](SECURITY.md). Do not
open a public issue for a security problem.

## Citing eduLIMS

To cite eduLIMS, use the "Cite this repository" button on the GitHub page,
which reads [`CITATION.cff`](CITATION.cff). Each release is archived on
Zenodo with a DOI. A change to the citation metadata edits `CITATION.cff` and
`.zenodo.json` together; `scripts/checks/citation.sh` checks that they agree.

## Licensing of contributions

eduLIMS is licensed under the Apache License, Version 2.0. By opening a pull
request you agree that your contribution is licensed under the same terms
(Apache-2.0, section 5). You keep your copyright.
