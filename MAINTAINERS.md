<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Maintainers and access continuity

## Roster

| Person | GitHub | Role | Since |
|---|---|---|---|
| Ruben Talstra | [@rubentalstra](https://github.com/rubentalstra) | Maintainer (sole) | 2026-11-11 |

**The bus factor of this project is one.** One person can merge, release and
deploy. Copyright is held by Ruben Talstra; the code is licensed under
Apache-2.0 ([LICENSE](LICENSE)).

## Publishing identities

| Identity | What it publishes | Held by |
|---|---|---|
| The GitHub organization `Vernum-Projecten` | the repository, issues, releases and settings | the organization's owners |
| The GHCR package `ghcr.io/vernum-projecten/edulims` | the container image, pushed by the release workflow | the organization, through `GITHUB_TOKEN` |
| `GITHUB_TOKEN` (per workflow run) | the image, its SBOM and its SLSA provenance | GitHub, minted per run |
| The Microsoft Entra ID app registration | sign-in for eduLIMS | Hanze ICT |
| The Linux VM and its network | the running deployment | Hanze ICT (infrastructure), the maintainer (Compose stack) |

## If the maintainer is unavailable

Nothing published disappears: a release tag and its image stay available, and
the running deployment keeps running. Nothing new ships. Every gate is a
committed workflow or script and every decision is written down
([GOVERNANCE.md](GOVERNANCE.md)), so the research group can name a new
maintainer who continues from the repository alone.

## Adding a maintainer

The route is in [GOVERNANCE.md](GOVERNANCE.md#handover).
