---
paths:
  - "src/**/*.{ts,tsx}"
  - "tests/**/*.{ts,tsx}"
  - "*.config.ts"
  - "tsconfig.json"
  - "biome.json"
  - "package.json"
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# TypeScript style

eduLIMS is TypeScript end to end: the native TypeScript 7 compiler (`tsc`,
`pnpm typecheck`), Biome 2.6 for formatting and lint (`pnpm lint`,
`pnpm fix`), and the strict compiler options in `tsconfig.json`. The bar is
the compiler and Biome at their strictest, and a rule without a failing check
is a wish, so every rule below names what enforces it.

## The compiler is the first reviewer

- `tsconfig.json` runs `strict` plus `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`,
  `noImplicitOverride`, `noUnusedLocals` and `noUnusedParameters`. Never relax
  one to make a change compile; fix the types.
- **No `any`.** Biome `noExplicitAny` is an error. Use `unknown` at a trust
  boundary and narrow it with a schema (Zod) or a type guard.
- **No non-null assertion `!`.** Biome `noNonNullAssertion` is an error. An
  index read is `T | undefined` under `noUncheckedIndexedAccess`; handle the
  `undefined` branch, or use `.at()`, a guard, or a destructuring default.
- **No `as` casts that lie.** `as const` and `satisfies` are fine. A cast from
  `unknown` to a domain type without validation is a defect; parse it.
- **No `@ts-ignore`.** `@ts-expect-error` only in a test that asserts a type
  error, with a reason on the same line.
- **`import type`** for type-only imports (Biome `useImportType`).
- **No floating promises** (Biome `noFloatingPromises`,
  `noMisusedPromises`): await it, return it, or `void` it with a reason in an
  event handler.
- **No `console.log`** (Biome `noConsole`, `error` and `warn` allowed). Server
  code logs through the logger in `src/server/`, never with personal data.

## Biome is the formatter and the linter

- `pnpm fix` formats and applies safe fixes; the PostToolUse hook
  `.claude/hooks/biome_check.sh` runs `biome check --write` on every file you
  edit and feeds remaining diagnostics back.
- A suppression is `// biome-ignore lint/<group>/<rule>: <reason>` on the
  smallest node, never a file-level ignore and never a rule disabled in
  `biome.json` to get a change through. A reason that cannot be written down
  means the code is wrong.
- Generated files stay out of Biome (`biome.json` `files.includes`):
  `src/routeTree.gen.ts`, `.claude/skills` (pnpm-linked library skills),
  `pnpm-lock.yaml`.
- **Vendored shadcn/ui code** (`src/components/ui/**`, `src/hooks/use-mobile.ts`)
  is formatted and linted, but one `overrides` entry in `biome.json` turns off
  the rules its upstream code breaks by design (ARIA roles on `div`s, index
  keys, the calendar's hook factories, the sidebar cookie, the chart's
  `<style>` injection). The files stay identical to the registry so a
  `shadcn add --overwrite` update is a clean diff; the rendered result is held
  to WCAG by the axe scans. That override is the only one: never extend it to
  app code, where every one of those rules stays an error.

## Server code stays on the server

TanStack Start renders on the server and hydrates in the browser, so a module
can end up in both bundles. The boundary is explicit:

- **Everything that touches the database, a secret, FerroEHR, the auth
  session or the file system lives under `src/server/`** and is reached from
  routes and components only through a server function (`createServerFn`) or
  a route loader that calls one (`tanstack.md`).
- **Every `createServerFn` validates its input** with `.validator(…)` and a
  Zod schema before the handler reads it, and **checks the session and role
  first** (`auth-security.md`). TypeScript types are not validation; the input
  crosses the network.
- **Server-only helpers** use `createServerOnlyFn` or import
  `@tanstack/react-start/server-only`, so an accidental client import fails the
  build instead of shipping the code.
- **No secret reaches the client.** Only variables prefixed `VITE_` reach the
  browser bundle, and none of them may hold a secret
  (<https://vite.dev/guide/env-and-mode>). Read server configuration from
  `process.env` inside `src/server/` and parse it once with a schema at
  startup, failing loud on a missing value.

## Types model the domain

- **Distinct ids are distinct types** where a mix-up is a privacy defect: a
  `StudentId`, a `SampleId`, a `PracticalId` and an EHR pseudonym
  are branded types, so passing a student id where a pseudonym belongs fails
  to compile.
- **Errors are values the caller can branch on.** A server function returns
  or throws a typed error (a discriminated union with a `kind`), never a
  string the caller has to match. Map it to an HTTP status and a message key from
  the i18n layer at the edge.
- **Discriminated unions over boolean flags** for state (submission status
  `draft | submitted | graded`, S8), with an exhaustive `switch` that
  ends in a `never` check.
- **Dates:** store and compare instants in UTC (`timestamptz`); format for
  the user in the active locale and `APP_TIME_ZONE` at render time, through
  the `Intl` helpers in `src/lib/i18n/` (ADR 0011). Deadline logic
  (S6) never compares formatted strings.

## Dependencies

- Exact versions only (`.npmrc` `save-exact=true`, `versions_guard.sh`). Add a
  dependency with `pnpm add <pkg>@<version>` after checking the version on the
  npm registry at that moment; never pin from memory.
- No new dependency for what the stack already provides (TanStack Form for
  forms, TanStack Table for tables, Zod for schemas, `radix-ui` through
  shadcn/ui for primitives).
- A library that ships agent skills is approved in `pnpm-workspace.yaml`
  `permissions:`; pnpm links the skills into `.claude/skills/` (`CLAUDE.md`).

## Files

- A hand-written file stays under 400 lines; split by responsibility before
  that. Tests are colocated as `*.test.ts(x)` next to the code or under
  `tests/unit/` (`testing.md`).
- Named exports only, except where a framework demands a default export.
- File names are kebab-case; React components are PascalCase symbols in
  kebab-case files, as shadcn/ui does.
