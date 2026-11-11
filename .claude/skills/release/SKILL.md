---
name: release
description: Walks the release cut checklist in docs/release.md for a vX.Y.Z milestone (milestone empty, gates green, changelog fragments assembled, tag, GHCR image with provenance and SBOM, Compose deploy, board status update) and reports each step. Use when the owner calls a release cut or asks "can we release".
allowed-tools: Read, Grep, Glob, Bash
argument-hint: "<vX.Y.Z>"
disable-model-invocation: true
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# /release

The procedure of record is **`docs/release.md`**; read it in full and follow
it in order. This skill is the pointer and the checks around it. If
`docs/release.md` does not exist yet, stop and say so: a release without its
checklist is not cut.

## Before the cut

1. **The milestone** `$ARGUMENTS` exists and holds no open issue or PR
   (`gh api repos/{owner}/{repo}/milestones --jq '.[] | select(.title ==
   "<vX.Y.Z>") | {open_issues, closed_issues, due_on}'`). Stragglers move to
   the next milestone only on the owner's word.
2. **`main` is green:** the latest `ci.yml` run on `main` concluded
   `success` (`gh run list --branch main --workflow ci.yml -L 1`).
3. **The changelog fragments** under `changelog.d/` assemble into a valid
   section (`.claude/rules/changelog.md`); every `security` fragment names its
   advisory.
4. **No open owner question** on a requirement that this release claims to
   deliver (`/phase-status` step 4).

## The cut

Follow `docs/release.md`: assemble the changelog, tag `vX.Y.Z` on the merge
commit, let the release workflow build the image, attest provenance and the
SBOM, scan it, and push it to GHCR (`.claude/rules/ci-cd.md`). Never retag;
a bad cut is fixed by a new patch version.

## After the cut

- Verify the image: `gh attestation verify
  oci://ghcr.io/vernum-projecten/edulims@<digest> --owner Vernum-Projecten`.
- Deploy per `docs/release.md` (`docker compose pull && docker compose up -d`
  on the VM, by the owner or with the owner's go-ahead).
- Post the board status update (`scripts/gh/project.sh update on-track
  "<what shipped, which requirement IDs, what is next>"`).
- Check the milestone is closed.

## Report

One line per step with PASS, FAIL or SKIPPED(reason), and the command output
for each FAIL. No attribution in the tag message or the release notes.
