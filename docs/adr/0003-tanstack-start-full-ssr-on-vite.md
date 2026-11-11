<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# 0003. TanStack Start with full SSR on Vite

- Status: Accepted
- Date: 2026-11-11
- Deciders: Ruben Talstra (maintainer)

## Context and problem statement

The PvA (3.6) left the frontend and backend framework to the design phase, to
be chosen on maintainability inside the CollabSpace and on support by the AI
coding assistant. eduLIMS needs business rules and access checks on the
server (Q-SEC-2), pages within 2 seconds (Q-PERF-1), forms and tables for
teachers, and one deployable container.

## Decision drivers

- One codebase and one language for server and UI.
- Type-safe routing and data loading.
- A fast first page load.
- A plain Node server that runs in one container.
- Good support by the AI coding assistant.

## Considered options

- TanStack Start, full SSR, on Vite with the Nitro Node server.
- TanStack Start on Rsbuild.
- Next.js.
- A separate single-page app plus a separate API service.

## Decision outcome

Chosen option: **TanStack Start with full server-side rendering on Vite 8,
served by Nitro's Node server**, with TanStack Router, Query, Form and Table.

TanStack Start also supports Rsbuild as its bundler. Vite is chosen because
the Nitro integration produces a standalone Node server
(`.output/server/index.mjs`) that fits the container, and because the tooling
used here (the Tailwind CSS Vite plugin, Vitest) is built around Vite.

### Consequences

- Good: server functions keep access checks and FerroEHR calls on the server.
- Good: one container that runs `node .output/server/index.mjs`.
- Good: Vitest shares the Vite configuration.
- Bad: TanStack Start is younger than Next.js. Versions are pinned exactly and
  moved on purpose ([VERSIONS.md](../VERSIONS.md)).
- Bad: Nitro 3 is a release candidate at the time of this decision.

## Pros and cons of the options

### TanStack Start on Rsbuild

- Good: supported by TanStack Start; fast builds.
- Bad: less of the tooling used here targets Rsbuild, and the Nitro server
  output is the Vite path.

### Next.js

- Good: mature, with a large community.
- Bad: more framework-specific conventions and less type-safe routing.

### Single-page app plus separate API

- Good: a clear split.
- Bad: two services and two deployables for one developer, and a slower first
  page load.
