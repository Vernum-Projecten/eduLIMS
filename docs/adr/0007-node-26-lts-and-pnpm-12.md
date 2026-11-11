<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# 0007. Node.js 26 LTS and pnpm 12

- Status: Accepted
- Date: 2026-11-11
- Deciders: Ruben Talstra (maintainer)

## Context and problem statement

Every developer, CI and the container must run the same runtime and package
manager, so that a build on one machine matches the others.

## Considered options

- Node.js 26 LTS with pnpm 12, pinned through `devEngines`.
- Node.js 24 LTS with pnpm 10.
- Bun.

## Decision outcome

Chosen option: **Node.js 26.13.0 (LTS) and pnpm 12.18.0**.

- `package.json` pins both in `devEngines` with `onFail: "error"`, and pnpm in
  `packageManager`. `engines.node` is `>=26.13.0 <27`.
- `.node-version` holds the Node version for version managers and CI.
- `.npmrc` sets `engine-strict=true` and `save-exact=true`, so every
  dependency is pinned exactly.
- pnpm installs the agent skills that the TanStack packages ship (the
  `skills` permission per package in `pnpm-workspace.yaml`) into
  `.claude/skills/`, which git ignores. An AI session gets the skills that
  match the installed versions.

### Consequences

- Good: an install on the wrong runtime or package manager fails at once.
- Good: LTS support for the life of the project.
- Bad: contributors install Node 26 and pnpm 12, or use a version manager.
- [VERSIONS.md](../VERSIONS.md) records the pins, and CI checks them.
