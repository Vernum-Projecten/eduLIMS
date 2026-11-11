---
paths:
  - ".github/**"
  - "scripts/**"
  - "docker/**"
  - "compose*.yaml"
  - "compose*.yml"
  - "docker-compose*.yml"
  - "Dockerfile"
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# CI/CD and supply-chain discipline

No specification governs this: our own design, grounded in the OWASP GitHub
Actions Security Cheat Sheet, SLSA v1.0, OpenSSF Scorecard and Sigstore. The
pipeline is GitHub Actions, images go to GHCR, and the deployment is Docker
Compose on one Linux VM (or one Azure environment; the product owner has not
decided). Azure Pipelines and Azure Container Registry from the plan of
approach are not used. The full design is `docs/ci-cd.md`; this file is the
enforceable discipline.

## Workflow security (every workflow, no exceptions)

- **Every `uses:` is pinned to a full commit SHA** with a trailing
  `# vX.Y.Z` comment. Dependabot (`github-actions`) bumps them. A tag or branch
  ref is a finding. Resolve the SHA from the tag at the moment you add it
  (`gh api repos/<owner>/<repo>/git/ref/tags/<tag>`), never from memory.
- **`permissions: {}` at workflow level**, with the minimum granted per job.
- **`persist-credentials: false`** on every `actions/checkout` that does not
  push with git.
- **No `${{ }}` context interpolation inside `run:`:** pass context through
  `env:` (template injection).
- **No `pull_request_target`** with a checkout of the PR head.
- **Publishing lanes restore no cache** (a cache an untrusted run could poison
  must not feed a release image).
- Enforced by the workflows lane: `actionlint` and `zizmor --min-severity=low`
  over `.github/workflows/`, `shellcheck --severity=style` over tracked shell
  scripts (the `.claude/hooks/` included).

## The merge gate

- **`main` merges through the merge queue.** `ci.yml` runs on `pull_request`
  and `merge_group`, and `conclusion` is the one required check. A job that
  reads the pull-request payload is gated on
  `github.event_name == 'pull_request'`, so it skips in the queue and
  `conclusion` counts the skip as a pass.
- **Zero required approvals; the owner arms auto-merge** with
  `gh pr merge <n> --auto`. `--admin` is denied in `.claude/settings.json`.
  The supervising teacher reviews AI-written changes in the PR as part of the
  Definition of Done, which is a process step, not a branch rule.
- **The CI lanes** mirror the local gate (`pnpm check`):
  `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`,
  `pnpm test:coverage` (fails under 70% on the core, `testing.md`),
  `pnpm build`, and `pnpm test:e2e` (Playwright with the axe scan) against the
  Compose test stack. `dependency-review-action` runs on PRs.
- **`changelog-guard`** fails a PR with no `changelog.d/` fragment unless it
  carries `no-changelog` (`changelog.md`).

## Supply chain

- **Releases are SLSA Build L3.** The image build and its attestation live in
  a reusable workflow (`on: workflow_call`), so the signing identity is not
  reachable from build steps. Do not inline the build and attest into a normal
  job.
- **Every release image carries provenance and a signed SBOM**
  (`actions/attest-build-provenance`, `actions/attest-sbom`, keyless through
  Sigstore with `id-token: write`). Consumers verify with
  `gh attestation verify oci://ghcr.io/vernum-projecten/edulims@<digest>
  --owner Vernum-Projecten`.
- **Images are scanned before they are tagged** (Trivy, pinned to one
  version), and a fixable HIGH or CRITICAL finding stops the tag. This is the
  "afhankelijkheden scannen in de pipeline" measure of the risk analysis.
- **Base images and Compose service images are pinned by digest**
  (`postgres:18.x@sha256:…`), and Dependabot (`docker`) bumps them.
- **Releases are immutable:** a bad cut is fixed by a new patch version, never
  a retag.
- **Exact versions everywhere:** `package.json` carries exact versions
  (`.npmrc` `save-exact=true`, enforced per edit by
  `.claude/hooks/versions_guard.sh`), and CI installs with
  `--frozen-lockfile`.
- **NEVER add AI/Claude attribution** to any commit, PR, workflow or release
  text.

## Never

- Never unpin a `uses:` to a tag or branch, widen a job's permissions without
  cause, interpolate context into `run:`, or restore a cache in a publishing
  lane.
- Never weaken a gate to go green (`testing.md`); fix the cause.
- Never put a secret in a workflow file, a Compose file or an image layer;
  secrets come from GitHub environments and the VM's `.env`, which is never
  committed.
