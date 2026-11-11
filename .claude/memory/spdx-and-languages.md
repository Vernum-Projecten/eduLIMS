---
name: spdx-and-languages
description: "Apache-2.0; every hand-written file opens with SPDX-FileCopyrightText: Ruben Talstra and SPDX-License-Identifier: Apache-2.0; docs, code, comments and commits in English, every UI string in Dutch; owner decision at the bootstrap"
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

Docs, code, identifiers, comments, commits, PRs and issues are English. Every
string a user of eduLIMS reads is Dutch (the users are Hanze LifeScience
students and staff); the root document sets `lang="nl"`.

**Why:** owner decisions at the bootstrap.

**How to apply:** `.claude/rules/comments.md` (the header) and
`.claude/rules/writing-style.md` (the languages).
