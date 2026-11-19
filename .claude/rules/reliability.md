<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Reliability and correctness rules

eduLIMS keeps the times and the accuracy that teams compete on, and shows
each team's work to that team only. A wrong time, a measurement attached to
the wrong sample or team, or a correct value on a student's screen is worse
than a loud failure. The rules below are the
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
- **The accuracy status and the tolerance warning each come from one tested
  function.** The accuracy status (G-03) derives from the released result,
  the correct value and the teacher's limits (D13); the warning of S15 from
  the value and the team's own tolerance. Each is tested at its limits. Never
  compare floats for equality; compare rounded values or integers. The form
  of a limit is open (O2), and the draft does not say on which side a value
  exactly on a limit falls: ask the owner, never pick one. (Tier 3.)
- **Times are taken on the server** in the transaction that records the
  event: the entry of a request (S12) and the release of a result (S15). No
  request carries a time the dashboard uses, and the client's clock never
  decides (Q-SIM-2, R-12). (Tier 3.)
- **Determinism:** anything a user compares across visits (a dashboard
  measure, a list order, the measurements of a requested test) has a defined order (`ORDER BY` a
  stable key), so the same data gives the same screen. (Review-enforced.)
- **Errors carry their cause:** `new AppError("…", { cause })`, so a log line
  shows the chain. A typed error is a discriminated union the caller can
  `switch` on, never a message string to match. (Tier 1.)
- **Idempotent writes where the network can retry:** a composition write
  carries the id of the record it writes, so a retry does not double a
  measurement or a result. (Tier 3.)
- **No silent catch.** `catch {}` and a `catch` that only logs and continues
  are banned in server code, unless a `// NOTE:` states why continuing is
  correct. (Review-enforced; Biome flags empty blocks.)
- **Dependencies are pinned and vetted:** exact versions, frozen lockfile in
  CI, a version checked on the registry at the moment it is added
  (`typescript-style.md`). (Tier 2 and 3.)
- **Availability during a simulation** (Q-REL-1: 99% of the simulation hours, recovery
  within one working day): health endpoints for Compose, restart policies, a
  tested backup and restore of both databases (`docs/`). (Tier 3 where testable.)

## When a check fights a legitimate case

Suppress at the smallest scope with a written reason
(`// biome-ignore lint/<group>/<rule>: <reason>`), never at file or project
level. A suppression without a reason is a finding. A file-level or
`biome.json` relaxation needs the owner's sign-off in the PR.
