<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# VEX statements

Vulnerability Exploitability eXchange documents in
[OpenVEX](https://openvex.dev) format. Each statement says whether one finding
in a published eduLIMS image can be exploited, and why. The products are the
two images: `pkg:oci/edulims` (the server) and `pkg:oci/edulims-migrate` (the
migration one-shot).

A VEX statement carries its argument: the vulnerability, the product, a
`status`, a `justification` from the OpenVEX vocabulary, and an
`impact_statement` a reader can check. An ignore list records a decision
without the reason, and nobody can re-evaluate it later.

## Rules

- **`not_affected` needs a justification from the OpenVEX vocabulary**, and
  the `impact_statement` says concretely why the code is unreachable in
  eduLIMS. "Low risk" is not a justification.
- **A finding you can fix is fixed, not VEXed.** These documents exist for
  findings in the distroless base image and in dependencies whose fix belongs
  to someone else.
- **Re-check on every base image bump.** A statement whose finding no longer
  fires is deleted.
- **An `affected` statement leaves its finding visible.** `trivy --vex` drops
  a finding only for `not_affected` or `fixed`; an `affected` finding stays in
  every scan with its `action_statement` beside it in the release record.

## Where the documents are read

- **The release's vulnerability record** (`.github/workflows/release.yml`,
  job `vulnerability-record`) scans both images by digest with every severity
  and unfixed findings included. `scripts/release/vex-coverage.sh` writes the
  record, `edulims-<tag>-vulnerability-record.json`, a release asset, and
  refuses the release while a HIGH or CRITICAL finding has no statement here
  that judges it. A statement judges a finding when it is `not_affected` with
  a `justification` or `impact_statement`, `affected` with an
  `action_statement`, or `fixed`, and matches by `vulnerability.name` or an
  `aliases` entry.
- **The weekly published-image scan** (`.github/workflows/image-scan.yml`)
  passes every document to Trivy as `--vex`.
- **The release gate** (`.github/workflows/scan-and-tag.yml`) passes none: it
  scans the untagged digest, which a `pkg:oci/...` product cannot match, and
  fails only on fixable HIGH and CRITICAL findings, which a rebuild resolves.

## Why the record gates at HIGH

Every finding goes into the record, and the record is published with the
release. Only HIGH and CRITICAL findings need a statement before the release
ships. eduLIMS runs on one internal host for lab education, behind the
institution's network, and the risk analysis asks for scanning and monthly
updates rather than a manufacturer's per-finding duty, so a statement for
every LOW finding in the Debian base would cost more than it protects. Raise
the floor with `vex-coverage.sh --min-severity` if that judgement changes.

## Documents

| File | Subject |
|---|---|
| `edulims.openvex.json` | Hand-written statements for both images. It holds none yet. |

To add a statement: append it to `statements`, raise the document's `version`
and set `timestamp` to now. A product id names the image (`pkg:oci/edulims`),
optionally with a digest (`pkg:oci/edulims@sha256:...`) when the statement
holds for one build only.
