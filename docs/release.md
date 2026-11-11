<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Cutting a release

eduLIMS releases follow [SemVer 2.0.0](https://semver.org/spec/v2.0.0.html),
starting at `0.1.0`. A milestone is a release: the milestone titled `vX.Y.Z`
holds the issues that version ships, and the release closes it. A published
release is immutable. A bad cut is fixed by the next patch version, never by
moving a tag or editing a published release.

## What the pipeline does

Pushing the tag `vX.Y.Z` starts `.github/workflows/release.yml`:

1. **plan** runs `scripts/release/plan.sh` at the tagged commit: the version
   in `package.json` (and `CITATION.cff`, when present), an empty
   `changelog.d/`, a well-formed `CHANGELOG.md` section `## [X.Y.Z] - date`,
   and a milestone `vX.Y.Z` with no open item. It writes the release notes.
2. **github release (draft)** waits for approval in the `release`
   environment, then creates the draft with the deploy bundle
   (`edulims-deploy-vX.Y.Z.tar.gz`: `compose.yaml`, `.env.example`, the
   PostgreSQL init script).
3. **build** (`release-build.yml`, SLSA Build L3) builds `.output/` from the
   frozen lockfile with no cache, packs `edulims-vX.Y.Z.tar.gz`, writes the
   CycloneDX SBOM `edulims-vX.Y.Z.cdx.json` with `pnpm sbom`, and attests
   provenance and SBOM through Sigstore.
4. **image** and **migrate-image** (`release-image.yml`, SLSA Build L3)
   build `ghcr.io/vernum-projecten/edulims` from the verified tarball and
   `ghcr.io/vernum-projecten/edulims-migrate` from source, for linux/amd64 and
   linux/arm64. Both are pushed by digest with no tag, with BuildKit
   provenance (`mode=max`), a syft SPDX SBOM per platform, and GitHub
   attestations pushed to the registry. Each lane verifies its own image with
   `gh attestation verify` before it finishes.
5. **vulnerability record** scans both digests with every severity and
   writes `edulims-vX.Y.Z-vulnerability-record.json`. It refuses the release
   while a HIGH or CRITICAL finding has no OpenVEX statement under
   `security/vex/` (`security/vex/README.md`).
6. **scan + tag** fails on a fixable HIGH or CRITICAL finding, and only then
   tags each digest `X.Y.Z`, `X.Y` and `latest` (`latest` not for a
   pre-release).
7. **github release (publish)** checks that every asset is attached and that
   each image tag resolves to the digest its lane pushed, then publishes.
8. **close the milestone** closes `vX.Y.Z` once every leg succeeded.

## The cut checklist

1. Every issue in the milestone `vX.Y.Z` is closed or moved to the next
   milestone.
2. On a branch from an up-to-date `main`:

   ```sh
   bash scripts/release/version.sh X.Y.Z
   bash scripts/release/changelog.sh --assemble X.Y.Z "$(date -u +%Y-%m-%d)"
   ```

   Review `CHANGELOG.md`, commit as `chore(release): vX.Y.Z`, open the pull
   request and merge it through the queue.
3. On the merged `main`, run every check the `plan` job runs:

   ```sh
   bash scripts/release/plan.sh vX.Y.Z
   ```

4. Tag and push. The tag is annotated, and signed when you have a signing key:

   ```sh
   git tag -s vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```

5. Approve the `release` environment in the run, then watch it finish.
6. Deploy (`docs/deployment.md`, "Updating").

A run that failed after the draft was created is re-run for the same tag,
dispatched at that tag:

```sh
gh workflow run Release --ref vX.Y.Z -f tag=vX.Y.Z
```

A release the vulnerability record refuses needs a fix (a base image bump, a
dependency bump) or a VEX statement, and then a new patch version; the
refused tag never gets image tags or a published page.

## Verifying a release

Every artifact is signed keylessly through Sigstore, and the certificate
names the workflow file that built it. Verify against that file, so an
artifact from any other workflow in the repository fails:

```sh
# The server image, by tag or by digest
gh attestation verify oci://ghcr.io/vernum-projecten/edulims:X.Y.Z \
  --repo Vernum-Projecten/eduLIMS \
  --signer-workflow Vernum-Projecten/eduLIMS/.github/workflows/release-image.yml

# The migration image
gh attestation verify oci://ghcr.io/vernum-projecten/edulims-migrate:X.Y.Z \
  --repo Vernum-Projecten/eduLIMS \
  --signer-workflow Vernum-Projecten/eduLIMS/.github/workflows/release-image.yml

# The SPDX SBOM of one platform manifest
gh attestation verify oci://ghcr.io/vernum-projecten/edulims@<platform digest> \
  --repo Vernum-Projecten/eduLIMS \
  --signer-workflow Vernum-Projecten/eduLIMS/.github/workflows/release-image.yml \
  --predicate-type https://spdx.dev/Document/v2.3

# The server tarball and its CycloneDX SBOM
gh release download vX.Y.Z --repo Vernum-Projecten/eduLIMS --pattern 'edulims-vX.Y.Z.tar.gz*'
gh attestation verify edulims-vX.Y.Z.tar.gz \
  --repo Vernum-Projecten/eduLIMS \
  --signer-workflow Vernum-Projecten/eduLIMS/.github/workflows/release-build.yml
gh attestation verify edulims-vX.Y.Z.tar.gz \
  --repo Vernum-Projecten/eduLIMS \
  --signer-workflow Vernum-Projecten/eduLIMS/.github/workflows/release-build.yml \
  --predicate-type https://cyclonedx.org/bom

# Offline, from the bundle attached to the release
gh attestation verify edulims-vX.Y.Z.tar.gz \
  --repo Vernum-Projecten/eduLIMS \
  --bundle edulims-vX.Y.Z.tar.gz.sigstore.json
```

The platform digests are in the image job's run summary, or in
`docker buildx imagetools inspect ghcr.io/vernum-projecten/edulims:X.Y.Z`.

## Repository settings the pipeline relies on

- **Release immutability** on (Settings, General, Releases), so a published
  release cannot be edited.
- **A `release` environment** with the maintainers as required reviewers,
  restricted to tags matching `v*`.
- **GHCR:** the first release creates the two packages private; make each
  public once (package settings) and link it to the repository, so the VM can
  pull without a token.
- **Tag protection** (a ruleset on `v*`) so only maintainers create release
  tags and nobody deletes or moves one.

## The scripts

| Script | Does |
|---|---|
| `scripts/release/version.sh` | sets or checks the version in `package.json` and `CITATION.cff` |
| `scripts/release/changelog.sh` | checks fragments, previews and assembles `CHANGELOG.md`, prints a version's notes |
| `scripts/release/plan.sh` | every release fact, and the release notes |
| `scripts/release/milestone.sh` | checks and closes the milestone titled as the tag |
| `scripts/release/vex-coverage.sh` | the vulnerability record |
| `scripts/release/install-trivy.sh` | the pinned Trivy, checked by sha256 |
| `scripts/release/install-pnpm.sh` | the pinned pnpm, checked by its npm integrity |

Each script with a `--self-test` mode proves itself in a scratch directory.
