<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Reliability and correctness rules

eduLIMS decides grades and shows measurements to the people they belong to. A
wrong grade, a measurement attached to the wrong sample, or another student's
result on a screen is worse than a loud failure. The rules below are the
standing bar for hand-written code; each names what enforces it. A rule
without a failing check is a wish, so a new rule comes with its check.

## Enforcement tiers (strongest first)

1. **Type property:** the type system makes the violation unrepresentable
   (branded ids, discriminated unions, `readonly`, `never` exhaustiveness).
2. **Compiler and Biome at error:** `tsc` with the strict options in
   `tsconfig.json`, Biome rules at `error` in `biome.json`; both fail
   `pnpm check` locally and in CI.
3. **A test or a CI job:** coverage thresholds, the axe scan, the role
   isolation tests, the migration run from empty.
4. **Review-enforced** (weakest; keep it small): only for properties no tool
   can check, marked below.

## The rules

- **Fail loud, never guess.** A missing configuration value stops the server
  at startup. A value that fails parsing is an error, never a default. Never
  turn an error into an empty list or a zero (`?? []`, `catch { return 0 }`)
  where the caller would show it as a real answer: an empty measurement list
  and "FerroEHR is unreachable" are different screens. (Review-enforced.)
- **Validate at every trust boundary** with a schema: server function input,
  search params, environment variables, the Gen5 file, FerroEHR answers. Inside
  the boundary, trust the types. (Tier 1 and 2.)
- **Grades are computed, not stored loose.** The final grade derives from the
  rubric scores by one tested function and cannot stay empty (D4). Rounding
  is explicit and tested at the boundaries (5.45, 5.5, 5.55). Never compare
  floats for equality; compare rounded values or integers. (Tier 3.)
- **Deadlines and locks are enforced on the server** in the same transaction
  that writes the submission (S6). The client's clock never decides. (Tier 3.)
- **Determinism:** anything a user compares across visits (a KPI, a list
  order, an export) has a defined order (`ORDER BY` a stable key), so the
  same data gives the same screen. (Review-enforced.)
- **Errors carry their cause:** `new AppError("…", { cause })`, so a log line
  shows the chain. A typed error is a discriminated union the caller can
  `switch` on, never a message string to match. (Tier 1.)
- **Idempotent writes where the network can retry:** the composition write
  for an upload carries the upload id, so a retry does not double a
  measurement. (Tier 3.)
- **No silent catch.** `catch {}` and a `catch` that only logs and continues
  are banned in server code, unless a `// NOTE:` states why continuing is
  correct. (Review-enforced; Biome flags empty blocks.)
- **Dependencies are pinned and vetted:** exact versions, frozen lockfile in
  CI, a version checked on the registry at the moment it is added
  (`typescript-style.md`). (Tier 2 and 3.)
- **Availability during practicum hours** (99%, recovery within one working
  day): health endpoints for Compose, restart policies, a tested backup and
  restore of both databases (`docs/`). (Tier 3 where testable.)

## When a check fights a legitimate case

Suppress at the smallest scope with a written reason
(`// biome-ignore lint/<group>/<rule>: <reason>`), never at file or project
level. A suppression without a reason is a finding. A file-level or
`biome.json` relaxation needs the owner's sign-off in the PR.
