---
name: owasp-baseline
description: "Security baseline is OWASP ASVS 5.0 Level 2, read from vendored copies in docs/security/vendor/ (ASVS, Top 10:2025, API Top 10 2023, 54 cheat sheets, Proactive Controls 2024); every ASVS id judged in docs/security/asvs-5.0-applicability.md; 2026-11-11"
metadata:
  type: project
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

eduLIMS is held to OWASP ASVS 5.0 at Level 2. The OWASP documents are
vendored byte for byte under `docs/security/vendor/` by
`scripts/vendor/owasp-*.sh` (tag and commit pinned, sha256 per file,
`--check` weekly in `pin-freshness.yml`); `docs/security/README.md` is the
index. `docs/security/asvs-5.0-applicability.md` judges all 345 ASVS ids,
and the `asvs-coverage` CI job keeps it complete.

**Why:** personal data of students under the GDPR and three roles that must
not see each other's data (R-01) put eduLIMS above Level 1; teaching data is
not the harm Level 3 is for. Pinned copies make every citation exact and work
offline.

**How to apply:** cite OWASP from the vendored copies with the requirement id
(`V8.2.2`, `A01`, `API3`), never from the web or memory; `/owasp-lookup`
finds and quotes it. A change that meets an ASVS row moves it to `met` and
cites the test in the same PR; never hand-edit a vendored file. The open
rows (status `open`) are gaps without an issue yet: V6.8.1 (account linking
between the two IdPs), V3.3.3, V7.1 and V7.3 (session lifetimes), V12.3
(TLS inside Compose), V14.3.2 (`Cache-Control` on authenticated responses)
among them.
