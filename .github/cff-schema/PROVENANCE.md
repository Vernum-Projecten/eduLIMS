<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Provenance

- Upstream: https://github.com/citation-file-format/citation-file-format
- Ref: tag `1.2.0` (commit `396f738fb025b1d8acdb02a56ffc923f95dc8999`)
- Files, fetched from
  `https://raw.githubusercontent.com/citation-file-format/citation-file-format/396f738fb025b1d8acdb02a56ffc923f95dc8999/<file>`:

  | File | Content | sha256 |
  |---|---|---|
  | `schema.json` | the CFF 1.2.0 JSON Schema (draft-07) | `0b8d22140da702d766df318dcff3a91af2f39521298dcf36d76315fd99cc169b` |
  | `LICENSE` | CC-BY-4.0, the upstream licence | `d26e56663498f0f17dbcb8a9bd50d344828948be08265f4fc97b4fc612e9be71` |

- Fetched: 2026-11-11. Byte-identical to the copy FerroEHR vendors.
- Never hand-edited. To update, fetch both files at the new tag's commit,
  replace them, and update the commit and the sums here.
- Licence: CC-BY-4.0, recorded in `REUSE.toml`.
- Consumer: the `citation` CI job (`.github/workflows/ci.yml`) runs
  `scripts/checks/citation.sh`, which validates `CITATION.cff` against
  `schema.json` with a pinned, hash-checked `fastjsonschema` over the
  `yq -o=json` conversion.
