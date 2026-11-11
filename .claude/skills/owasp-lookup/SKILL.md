---
name: owasp-lookup
description: Finds the OWASP ASVS 5.0 requirement, Top 10:2025 or API Security Top 10 2023 category, or cheat sheet section for a security topic in the copies vendored under docs/security/vendor/, quotes it verbatim with its id and source path, and says how eduLIMS stands on it from the ASVS applicability table. Use before designing, building or reviewing anything security-relevant (sign-in, sessions, roles, uploads, headers, logging, the integrations), or when an issue, a finding or a PR cites an ASVS id such as V8.2.2.
allowed-tools: Read, Grep, Glob, Bash(jq:*), Bash(grep:*)
argument-hint: "<ASVS id, Top 10 id or topic, e.g. V8.2.2, A01, API3, file upload, CSRF>"
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# /owasp-lookup

Answer "what does OWASP say" from the vendored copies, never from memory and
never from the web: the copies are the pinned versions the baseline cites
(`docs/security/README.md`). Quote the text exactly; a paraphrase is not a
citation.

## Where to look

1. **An ASVS 5.0 id** (`V<chapter>.<section>.<n>`, for example `V8.2.2`):
   - The requirement and its level from the flat list:
     `jq -r '.requirements[] | select(.req_id == "V8.2.2") | "\(.req_id) L\(.L) \(.req_description)"' docs/security/vendor/asvs/docs_en/OWASP_Application_Security_Verification_Standard_5.0.0_en.flat.json`
   - The same row in the chapter, with the section's intro text around it:
     `grep -n '\*\*8\.2\.2\*\*' docs/security/vendor/asvs/en/*.md`, then Read
     the section heading above it.
   - eduLIMS's judgement: `grep -n '^| V8.2.2 |' docs/security/asvs-5.0-applicability.md`
     (applies, where, verification, status).
2. **A topic** (CSRF, upload, session timeout): Grep the ASVS chapters
   (`docs/security/vendor/asvs/en/0x1*-V*.md`, `0x2*-V*.md`) and the
   cheat sheets (`docs/security/vendor/cheatsheets/*.md`) for the topic
   words, case-insensitive. The chapter names map topics to chapters: V1
   encoding, V2 validation and business logic, V3 web frontend, V4 API, V5
   files, V6 authentication, V7 sessions, V8 authorisation, V9 tokens, V10
   OAuth and OIDC, V11 cryptography, V12 TLS, V13 configuration, V14 data
   protection, V15 secure coding and the supply chain, V16 logging and errors.
3. **A Top 10:2025 category** (`A01` to `A10`): `docs/security/vendor/top10/A0*_2025-*.md`
   and `A10_2025-*.md`; eduLIMS's answer is the row in
   `docs/security/top-10-2025-mapping.md`.
4. **An API Security Top 10 2023 risk** (`API1` to `API10`):
   `docs/security/vendor/api-security/0xa*.md`; eduLIMS's answer is in
   `docs/security/api-top-10-2023-mapping.md`.
5. **A proactive control** (`C1` to `C10`): `docs/security/vendor/proactive-controls/the-top-10/`.

## What to return

- The verbatim text in a block quote, with its id (`V8.2.2`, level `L1`),
  its section heading, and its path and line (`docs/security/vendor/asvs/en/0x17-V8-Authorization.md:28`).
- The most useful cheat sheet section for it, quoted the same way, with the
  sheet's path and heading.
- eduLIMS's status from the applicability table, quoted as the row says it.
  If the task in front of you changes that status (it meets the requirement,
  or breaks a `met` row), say so: the row is updated in the same change.
- Every gap: a requirement that is ambiguous for eduLIMS, a row whose
  judgement looks wrong against the code, or a topic no vendored document
  covers. Name it as a question for the owner; never settle it yourself.

## Never

- Never quote OWASP from memory or a web page; if the vendored copy lacks
  it, say the copy lacks it.
- Never edit a file under `docs/security/vendor/`: the trees are byte for
  byte upstream and `scripts/vendor/owasp-*.sh --check` would fail.
