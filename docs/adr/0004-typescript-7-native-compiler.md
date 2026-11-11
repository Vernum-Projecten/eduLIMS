<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# 0004. TypeScript 7 native compiler

- Status: Accepted
- Date: 2026-11-11
- Deciders: Ruben Talstra (maintainer)

## Context and problem statement

eduLIMS is written in TypeScript. TypeScript 7 is the native port of the
compiler, with much faster type checking. It does not ship the JavaScript
compiler API that tools built for TypeScript 5 load in-process.

## Decision drivers

- Fast type checking in CI and in the editor.
- A lint setup that does not depend on the TypeScript JavaScript API.

## Considered options

- TypeScript 7 (native `tsc`) with Biome for lint and format.
- TypeScript 5 with ESLint and typescript-eslint type-aware rules.

## Decision outcome

Chosen option: **TypeScript 7.0** (`typescript@7.0.2`) for type checking
(`pnpm typecheck`) and **Biome** for lint and format (`pnpm lint`).

### Consequences

- Good: type checking is fast enough to run on every change.
- Good: one tool (Biome) for lint, format and import order.
- Bad: tools that need the TypeScript JavaScript API are not used, for example
  typescript-eslint's type-aware rules. Biome's own type-aware rules
  (`noFloatingPromises`, `noMisusedPromises`) cover the most important cases.
- Bad: a library or tool that imports `typescript` as a library needs a check
  before it is adopted.
