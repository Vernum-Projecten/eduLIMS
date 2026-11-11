---
paths:
  - "src/**/*.{ts,tsx}"
  - "tests/**/*.{ts,tsx}"
  - "scripts/**"
  - "*.config.ts"
  - ".claude/hooks/**"
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Comments and documentation (TSDoc)

The authority is TSDoc (<https://tsdoc.org/>) for documentation comments and
the Google style guide on comments
(<https://developers.google.com/style/api-reference-comments>). Comments rot
faster than any other artefact, so essays in code are banned. This file is the
single home of the comment rules.

## The prime rule: a comment earns its lines

Code says WHAT; a comment exists only for what the code cannot show: the
requirement or specification citation, the non-obvious why, the constraint.
Everything else has a durable home:

| Content | Home |
|---|---|
| Decisions, trade-offs, history | the PR description or the issue |
| Architecture | `docs/architecture.md` |
| API contract of an exported item | its TSDoc comment |
| What changed and why it is correct | the PR, never the code |

**No change narration** ("previously…", "now correctly…", "after the
refactor…"). A comment describes the code as it is.

## The file header

Every hand-written file in a format that takes a comment opens with the two
SPDX lines, in that format's comment syntax, before anything but a shebang, a
doctype or Markdown front matter:

```ts
// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0
```

Generated files (`src/routeTree.gen.ts`, the Kysely type file, shadcn
components as added by the CLI until a person edits them), JSON files, the
lockfile and changelog fragments carry none. The header does not count toward
the budgets below.

## Budgets

- `// NOTE:` is a citation plus ONE sentence, **at most 3 lines**. The full
  reasoning lives on the issue or PR.
- A plain `//` comment run is **at most 8 lines**. Longer prose is either API
  documentation (move it into the TSDoc of the item) or a record (move it to
  the PR).
- Block comments (`/* … */`) are banned except as TSDoc (`/** … */`) directly
  above a declaration, and the JSX comment form `{/* … */}`, which JSX
  requires.

## TSDoc (`/** … */`)

- Document every exported function, component, type and constant of
  `src/server/` and `src/lib/`. A route file's `Route` export and a shadcn
  primitive need none.
- **Summary line:** one short sentence in the third person present ("Returns
  the samples of one practicum.", never "Return…" or "This function…"),
  followed by a blank line before any detail.
- Use `@param`, `@returns`, `@throws` only when the name and type do not
  already say it. `@throws` names the error class and when.
- Code in backticks; link with `{@link Name}`. Cite durable references only:
  a requirement ID with its acceptance criterion, the openEHR or HL7
  specification section, WCAG success criteria, the official docs of a pinned
  package. Never cite an internal markdown file as the authority.

## Annotation vocabulary (the only sanctioned markers)

- `// TODO(#N): <what is missing>`: pending work, ALWAYS with its tracker
  issue. Deferred work is a TODO, never prose ("later", "for now").
- `// NOTE: <citation + one sentence>`: a settled decision, with the
  requirement ID, the specification section, or the explicit flag "no
  requirement governs this: our own design".
- `// biome-ignore <rule>: <reason>`: a scoped lint suppression; the reason is
  mandatory (`typescript-style.md`).
- No other marker exists: `FIXME`, `HACK`, `XXX`, `WIP` are banned.

## Enforcement

Review-enforced, with Biome catching what it can (unused code, suppressions
without a reason). The `ui-reviewer` and `security-reviewer` agents flag
change narration and stale citations.
