<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# CI/CD and supply chain

No specification governs this design. It is grounded in SLSA v1.0, the
OpenSSF Scorecard, Sigstore, and the OWASP GitHub Actions Security Cheat
Sheet, and it follows the pipeline of the Ferro family, adapted to a
TypeScript application built with pnpm. The owner chose GitHub over Azure
DevOps ([ADR 0002](adr/0002-github-instead-of-azure-devops.md)), and every
gate the test strategy asks for (automated tests on each change, a dependency
scan, no merge without green tests) runs here.

## Workflow security rules

Every workflow and composite action follows these rules, and the
`zizmor` and `actionlint` jobs enforce them:

- Every `uses:` is pinned to a full commit SHA with a trailing `# vX.Y.Z`
  comment. A container image is pinned by digest. Dependabot moves both.
- `permissions: {}` at workflow level, and each job grants the least it
  needs.
- `persist-credentials: false` on every `actions/checkout`.
- No `${{ }}` expression inside `run:`. A context value reaches a script
  through `env:`, which prevents template injection.
- A publishing lane restores no cache, because an untrusted run could have
  written it. The composite action takes `cache: "false"` for that.
- A job that reads the pull-request payload runs only on
  `github.event_name == 'pull_request'`.

## The lanes

| Workflow                                             | What it does                                                                                                                                                                                 | Trigger                                              |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `ci.yml` `zizmor`, `actionlint`, `shellcheck`        | Security and correctness analysis of `.github/`, and shellcheck at `--severity=style` over every tracked `*.sh`                                                                              | every change                                         |
| `ci.yml` `install`                                   | `pnpm install --frozen-lockfile` once, so lockfile drift fails fast; reports whether the e2e scripts exist                                                                                   | every change                                         |
| `ci.yml` `typecheck`, `lint`, `build`                | `pnpm typecheck` (native `tsc`), `biome ci .`, `pnpm build`                                                                                                                                  | every change                                         |
| `ci.yml` `test`                                      | `pnpm test:coverage` with the 70% thresholds of `vitest.config.ts` (the coverage report is uploaded as the `coverage` artifact), on a PostgreSQL 18 service container (`TEST_DATABASE_URL`) as the non-superuser `edulims` role (see [The test database role](#the-test-database-role)) | every change                                         |
| `ci.yml` `e2e`                                       | Playwright with the axe scan against a PostgreSQL 18 service container (`E2E_DATABASE_URL`) as the same `edulims` role, emptied, migrated and seeded by `pnpm db:reset`, with the development login; the browsers are cached by Playwright version | every change, once `test:e2e` and `db:migrate` exist |
| `ci.yml` `dependency-review`                         | Blocks a pull request that adds a dependency with a known HIGH or CRITICAL vulnerability                                                                                                     | pull requests                                        |
| `ci.yml` `audit`                                     | `pnpm audit --prod --audit-level=high` and OSV-Scanner over `pnpm-lock.yaml`                                                                                                                 | every change                                         |
| `ci.yml` `licenses`                                  | Every production dependency carries a license `scripts/checks/licenses.allow` names                                                                                                          | every change                                         |
| `ci.yml` `pr-title`                                  | The title is a Conventional Commits header (`scripts/checks/pr-title.sh`)                                                                                                                    | pull requests                                        |
| `ci.yml` `linked-issue`                              | The description holds `Closes #<n>`, unless the pull request carries `no-issue`                                                                                                              | pull requests by people                              |
| `ci.yml` `changelog-guard`                           | The change adds a fragment under `changelog.d/`, unless it carries `no-changelog`                                                                                                            | pull requests by people                              |
| `ci.yml` `tracker-helpers`, `guard-self-tests`       | The `--self-test` of every script under `scripts/gh/` and `scripts/checks/`                                                                                                                  | every change                                         |
| `ci.yml` `brand`                                     | The brand palette holds its `safe:` contrast claims and the theme's destructive colour holds 4.5:1 on its tints (`scripts/checks/brand-contrast.sh`), and the served icons match `assets/brand/`                                                         | every change                                         |
| `ci.yml` `asvs-coverage` | Every ASVS 5.0.0 id of the vendored list has one judged row in `docs/security/asvs-5.0-applicability.md` (`scripts/checks/asvs-coverage.sh`) | every change |
| `ci.yml` `ferro-compose` | FerroEHR and FerroBRIDGE accept the environment `compose.yaml` and `compose.dev.yaml` give them: each pinned image runs its own `config check`, offline (`scripts/checks/ferro-compose.sh`) | every change |
| `ci.yml` `image-paths`, `image` | Both targets of `docker/Dockerfile` (`tools`, `runtime`) build for linux/amd64 and linux/arm64 with the release lane's build arguments, from source, with no login, no push and no cache; the release lane builds `runtime` from the attested tarball instead (#217) | pull requests and merge groups that touch `docker/`, `.dockerignore`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc`, `.node-version`, `ci.yml` or the release workflows; every push to main |
| `ci.yml` `integration-paths`, `integration` (`integration.yml`) | The `compose.dev.yaml` stack (PostgreSQL 18, Keycloak, FerroEHR with authentication on, FerroBRIDGE) at its pinned image digests under its own Compose project: `scripts/dev/ferroehr-auth-check.sh`, FerroBRIDGE's `/health/readiness` answering 200, and `tests/integration/ferro-stack.test.ts` (the openEHR client gets a token and lists the templates; the B3 check reports both services available), with `EDULIMS_IT_REQUIRE_STACK=1` so an unreachable stack fails; every container's log on failure (#150) | pull requests and merge groups that touch `src/server/openehr/`, `src/server/integrations/`, `src/server/upload/`, `compose*.yaml`, `docker/`, `config/`, the lane's test or script, `ci.yml` or `integration.yml`; every push to main; nightly on main |
| `ci.yml` `conclusion`                                | Fails when any job above failed or was cancelled; a skip counts as a pass                                                                                                                    | every change                                         |
| `pr-guards.yml`                                      | On a title, description, or escape-label change, re-runs the guard it affects in the head commit's CI run                                                                                    | pull-request edits and labels                        |
| `codeql.yml`                                         | CodeQL `security-extended` for `javascript-typescript` and `actions`                                                                                                                         | push, pull request, weekly                           |
| `scorecard.yml`                                      | OpenSSF Scorecard, results published, SARIF to code scanning                                                                                                                                 | push to main, weekly, ruleset change                 |
| `pin-freshness.yml`                                  | Node.js, pnpm, the PostgreSQL service image, actionlint, zizmor, and shellcheck compared with their newest release; one issue when one is behind. The vendored OWASP trees re-fetched and diffed (`scripts/vendor/owasp-*.sh --check`); one issue on drift | weekly                                               |
| `release*.yml`, `scan-and-tag.yml`, `image-scan.yml` | The release pipeline (see the contract below)                                                                                                                                                | tags, weekly                                         |

Every lane that needs Node.js uses `.github/actions/setup-node-pnpm`. It
installs the pnpm release `packageManager` pins and the Node.js release
`.node-version` pins, so each pin lives in one file.

Dependabot (`.github/dependabot.yml`) watches npm, the GitHub Actions, and
the images under `docker/`, weekly with a cooldown. TanStack, `@types/*`,
and the build tooling (Biome, Vitest, Vite, TypeScript) each move in one
grouped pull request.

## The test database role

The `test` and `e2e` lanes connect as the role a developer's tests use on
the dev stack, so a path that works only for a superuser fails in CI too
(#202). The service container starts with the image's bootstrap superuser
`postgres`, which no test connects as. A step after the checkout runs the
init scripts `compose.dev.yaml` mounts, inside the container with
`docker exec`:

- `docker/postgres/init/20-edulims.sh` creates the `edulims` login role
  (NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION) and the `edulims`
  database it owns.
- `docker/postgres/init/30-edulims-test-databases.sh` grants `edulims`
  CREATEDB and creates `edulims_test` and `edulims_e2e`, owned by it, with
  CONNECT revoked from PUBLIC.

The step then fails when `edulims` is missing or is a superuser.
`TEST_DATABASE_URL` and `E2E_DATABASE_URL` name `edulims`, and each run
creates its own run database beside the base database, as on a developer
machine. A change to the role or its grants goes into those scripts, so the
dev stack and CI stay the same.

## The merge gate

`main` takes every change through a pull request and the merge queue
(<https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue>).
The `main` ruleset requires:

- a pull request, with 0 required approvals;
- the one status check `conclusion`, reported by GitHub Actions;
- the merge queue, squash only, all-green grouping, up to 5 entries per
  build;
- linear history and signed commits;
- no force push and no deletion.

A branch ruleset requires checks by name, so naming each job would mean a
settings change every time a job is added. `conclusion` is the one name that
stays, and it treats a skipped job as a pass.

Arm a pull request with `gh pr merge <n> --auto`. The queue adds it once
`conclusion` is green, builds it on top of the entries ahead of it, and
merges the squashed commit. The repository deletes the head branch after the
merge. Because the queue tests the combined result, the strict up-to-date
policy is off and no pull request needs a rebase only because another one
merged first.

`ci.yml` runs on `merge_group`. The guards that read the pull request
(`pr-title`, `linked-issue`, `changelog-guard`, `dependency-review`) skip
there: each pull request passed them before it joined the queue.

The pull-request trigger lists `opened`, `synchronize`, and `reopened` only,
so a commit gets one CI run. An edit or a label event would start a second
run on the same commit, the concurrency group would cancel the first, and its
`conclusion` would report a failure. The guards read the title, the
description, and the labels from the API when they run, and `pr-guards.yml`
re-runs the affected guard after such an event, which re-runs `conclusion`
with it.

Bot pull requests skip `linked-issue` and `changelog-guard`: a dependency
bump has no issue and no user-visible entry of its own. Their titles still
pass `pr-title`, because Dependabot writes `build(deps): ...` and
`ci(deps): ...`.

## The release contract (SLSA Build L3)

The release lanes belong to the release workflows. This section is the
contract they meet.

SLSA Build L3 adds two guarantees over L2: builds are isolated from each
other, and the signing identity is out of reach of the build steps, so the
provenance cannot be forged. On GitHub-hosted runners that holds when the
build and its attestation run in a reusable workflow:

- **`release-build.yml`** is `on: workflow_call`. It checks out the tag,
  installs with `pnpm install --frozen-lockfile` and no cache, runs
  `pnpm build`, and packs the server output. In the same job it writes a
  CycloneDX SBOM of the production dependencies and signs both:
  `actions/attest-build-provenance` for the artifact and `actions/attest-sbom`
  for the SBOM, keyless through Sigstore with `id-token: write`. The caller
  cannot inject a step into it, so the certificate names that workflow.
- **The image** is built in a reusable workflow on the same terms, pushed to
  GHCR by digest with no tag, with provenance and SBOM attestations on the
  index and on each platform manifest.
- **Trivy and VEX:** the pushed digest is scanned at every severity. Every
  finding has an OpenVEX statement under `security/vex/` or the release
  stops; a fixable HIGH or CRITICAL finding stops it in any case. Only then
  does `scan-and-tag.yml` apply the version tags. `image-scan.yml` scans the
  published images again each week with the VEX documents applied.
- **Immutable releases:** the release is a draft until every asset is
  attached and verified, and it is published last. The platform then freezes
  it. A bad release is fixed by a new patch version, never by a retag; the
  `release-tags` ruleset refuses a moved or deleted `v*` tag.
- **Release branches:** a maintenance line lives on `release/<major>.<minor>`.
  The `release-branches` ruleset gives it the `main` rules without the merge
  queue (pull request, the `conclusion` check, linear signed history, no force
  push or deletion), and `ci.yml` runs on pull requests into it. The
  `release` environment accepts deployments from `v*` tags only and waits for
  its required reviewer before anything is built.

A consumer verifies against the signer workflow:

```sh
gh attestation verify edulims-<version>.tar.gz -R Vernum-Projecten/eduLIMS \
  --signer-workflow Vernum-Projecten/eduLIMS/.github/workflows/release-build.yml
gh attestation verify oci://ghcr.io/vernum-projecten/edulims@<digest> \
  -R Vernum-Projecten/eduLIMS
```

GHCR tags are mutable, so the Docker Compose deployment pins the image by
digest. The claim is L3 by GitHub's builder isolation; reproducible and
hermetic builds are separate SLSA tracks and are not claimed.

## OpenSSF Scorecard targets

| Check                  | Target                                  | How                                                                     |
| ---------------------- | --------------------------------------- | ----------------------------------------------------------------------- |
| Pinned-Dependencies    | 10                                      | SHA-pinned `uses:`, digest-pinned images, `--frozen-lockfile`           |
| Token-Permissions      | 10                                      | `permissions: {}` and per-job grants                                    |
| Dangerous-Workflow     | 10                                      | No untrusted checkout in `pull_request_target`; no `run:` interpolation |
| Dependency-Update-Tool | 10                                      | Dependabot                                                              |
| SAST                   | 10                                      | CodeQL on every change                                                  |
| Signed-Releases        | 10                                      | Sigstore provenance on every release asset                              |
| Security-Policy        | 10                                      | `SECURITY.md` and private vulnerability reporting                       |
| License                | 10                                      | Apache-2.0 in `LICENSE`                                                 |
| Vulnerabilities        | 10                                      | `audit`, `dependency-review`, Dependabot security updates               |
| CI-Tests               | 10                                      | `conclusion` on every pull request                                      |
| Branch-Protection      | as high as a solo repository allows     | The `main` ruleset                                                      |
| Code-Review            | low, accepted                           | Needs a second person to approve                                        |
| Maintained             | low until the repository is 90 days old | Expires by itself                                                       |

The score is an outcome. Code-Review and the top Branch-Protection tiers
want a second approver; granting a bypass to fake one would score worse.

## Repository settings

`scripts/gh/repo-settings.sh` applies the settings above through the API and
is safe to run again. `--dry-run` prints every call and changes nothing. It
sets squash-only merges with auto-merge and branch deletion, the `main`,
`release-branches` and `release-tags` rulesets, the `release` environment, secret scanning with push protection, Dependabot
alerts and security updates, private vulnerability reporting, the CodeQL
default setup off (`codeql.yml` is the advanced setup), a read-only default
`GITHUB_TOKEN`, required SHA pinning of actions, immutable releases, the About section
(description, homepage, topics) and GitHub Pages on `edulims.eu` with HTTPS.

The tracker helpers under `scripts/gh/` each carry a `--self-test`:

- `labels.sh` syncs the labels to `.github/labels.yml`, the single source
  (`--dry-run` prints the plan).
- `fields.sh` sets the native issue type (Bug, Feature, Task) and the
  organisation's Priority and Effort fields.
- `rel.sh` sets sub-issues and blocked-by edges.
- `project.sh` moves an issue on the "eduLIMS Roadmap" board.

## Sources

SLSA v1.0 <https://slsa.dev/spec/v1.0/levels> · GitHub artifact attestations
<https://docs.github.com/actions/security-guides/using-artifact-attestations-and-reusable-workflows-to-achieve-slsa-v1-build-level-3>
· CycloneDX <https://cyclonedx.org/> · OpenSSF Scorecard
<https://scorecard.dev/> · OWASP GitHub Actions Cheat Sheet
([vendored copy](security/vendor/cheatsheets/GitHub_Actions_Security_Cheat_Sheet.md))
· zizmor <https://docs.zizmor.sh/> · Rulesets
<https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets>
· Conventional Commits <https://www.conventionalcommits.org/en/v1.0.0/>
