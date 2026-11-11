---
name: spdx-and-languages
description: "Apache-2.0; every hand-written file opens with SPDX-FileCopyrightText: Ruben Talstra and SPDX-License-Identifier: Apache-2.0; everything in English including UI copy; UI text goes through the i18n layer, Dutch only as the nl translation (ADR 0011); owner decisions"
metadata:
  type: project
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

eduLIMS is licensed Apache-2.0 (`LICENSE`). Every hand-written file carries
the two SPDX lines in its own comment syntax:

```ts
// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0
```

Markdown uses HTML comments after any front matter; shell scripts put them
after the shebang. JSON files, generated files and the lockfile carry none.

Docs, code, identifiers, comments, commits, PRs, issues and the UI copy are
English. Every string a user of eduLIMS reads goes through the i18n layer:
English is the source and default locale, Dutch the `nl` translation. Never
hard-code a user-visible string. The root document's `lang` follows the
active locale.

**Why:** owner decisions; the language change is ADR 0011.

**How to apply:** `.claude/rules/comments.md` (the header) and
`.claude/rules/writing-style.md` (the languages).
