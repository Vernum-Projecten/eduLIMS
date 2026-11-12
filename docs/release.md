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
   in `package.json`, `CITATION.cff` and `.zenodo.json`, an empty
   `changelog.d/`, a well-formed `CHANGELOG.md` section `## [X.Y.Z] - date`,
   and a milestone `vX.Y.Z` with no open item. It writes the release notes.
2. **github release (draft)** waits for approval in the `release`
   environment, then creates the draft with the deploy bundle
   (`edulims-deploy-vX.Y.Z.tar.gz`: `compose.yaml`, `compose.logship.yaml`
   with `docker/logship/`, `.env.example`, the PostgreSQL init script,
   `config/ferroehr.toml.example` and the operational templates in
   `docker/ferroehr/definitions/`).
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

   `version.sh` sets the version in `package.json`, `version` and
   `date-released` in `CITATION.cff` (it adds `date-released` on the first
   cut), and `version`, `publication_date` and the `isSupplementTo` link to
   `.../tree/vX.Y.Z` in `.zenodo.json`. Run `bash scripts/checks/citation.sh`
   to confirm the three files agree. Review `CHANGELOG.md`, commit as
   `chore(release): vX.Y.Z`, open the pull request and merge it through the
   queue. The citation metadata must be right before the tag: Zenodo archives
   the tagged tree with `.zenodo.json` as it is at that commit, and the
   archived files can never be changed.
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

## Citation and Zenodo

`CITATION.cff` drives GitHub's "Cite this repository" button. `.zenodo.json`
describes the Zenodo deposit of each release; when both files exist, Zenodo
reads only `.zenodo.json`
(<https://help.zenodo.org/docs/github/describe-software/zenodo-json/>), so the
two carry the same title, abstract, author with ORCID, licence, keywords,
version and date. The `citation` CI job (`scripts/checks/citation.sh`)
validates `CITATION.cff` against the vendored CFF 1.2.0 schema
(`.github/cff-schema/`) and fails when the files disagree with each other or
with `package.json`.

Zenodo's GitHub integration (invenio-github) archives a release when GitHub
sends the `release` webhook for a release that is not a draft, which is the
`published` event. The pipeline creates the release as a draft and publishes
it in its last step, so Zenodo sees it once, published. Creating the draft
triggers nothing. Pre-releases are archived too. Zenodo downloads the source
archive of the tag, not the release assets; release immutability does not
affect it, because the tag and its tree do not change.

### One-time setup (the owner)

1. Sign in at <https://zenodo.org> with "Log in with GitHub", as an account
   with admin rights on `Vernum-Projecten/eduLIMS` (Zenodo installs a webhook
   on the repository).
2. If the `Vernum-Projecten` organisation restricts OAuth app access (Settings,
   Third-party access, OAuth app policy), an organisation owner approves the
   Zenodo app there, or approves the request GitHub shows during sign-in.
   Until then the repository does not appear in Zenodo.
3. In Zenodo, open the profile menu, choose GitHub, click "Sync now", and
   switch on `Vernum-Projecten/eduLIMS`. Releases published before this
   point are not archived.
4. Cut the next release as above. When it publishes, Zenodo mints two DOIs:
   the version DOI of this release, and the concept DOI that always resolves
   to the newest version. Check the record: the title and creators must be
   those in `.zenodo.json`. A record with GitHub's repository name as title
   or the contributor list as creators means Zenodo ignored the file; its
   metadata can then be corrected only by the owner in the Zenodo web
   interface.
5. In a follow-up pull request, add the concept DOI (the record's "Cite all
   versions" DOI, not the version DOI) to `CITATION.cff`:

   ```yaml
   identifiers:
     - type: doi
       value: 10.5281/zenodo.NNNNNNNN
       description: "The concept DOI of the Zenodo software archive; resolves to the latest archived release."
   ```

   and a DOI badge to the badge block of `README.md`:

   ```markdown
   [![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.NNNNNNNN.svg)](https://doi.org/10.5281/zenodo.NNNNNNNN)
   ```

   `.zenodo.json` does not change: it never carries a `doi`, because Zenodo
   mints the DOIs itself.

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

GHCR has no OCI referrers API (`GET /v2/<name>/referrers/<digest>` answers
404), so each attestation the image lanes push gets the OCI fallback tag
`sha256-<digest>`, named after the digest of its subject. GHCR's package page
headlines the newest tag it holds as "latest", and after a release that is
one of these attestation tags, without a description. It is a GHCR interface
limit: pull by version tag (`ghcr.io/vernum-projecten/edulims:X.Y.Z`), and
the version tags carry the full OCI labels and annotations.

The image attestation jobs also hold `artifact-metadata: write`, so
`actions/attest` records each pushed image on the organisation's linked
artifacts page
([Use artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations),
"linked artifacts"). The calling jobs in `release.yml` grant it too, because
a reusable workflow can only narrow the permissions its caller grants.

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
| `scripts/release/version.sh` | sets or checks the version in `package.json`, `CITATION.cff` and `.zenodo.json`, with the release date and the tag link |
| `scripts/checks/citation.sh` | validates `CITATION.cff` and holds it, `.zenodo.json` and `package.json` to each other |
| `scripts/release/changelog.sh` | checks fragments, previews and assembles `CHANGELOG.md`, prints a version's notes |
| `scripts/release/plan.sh` | every release fact, and the release notes |
| `scripts/release/milestone.sh` | checks and closes the milestone titled as the tag |
| `scripts/release/vex-coverage.sh` | the vulnerability record |
| `scripts/release/install-trivy.sh` | the pinned Trivy, checked by sha256 |
| `scripts/release/install-pnpm.sh` | the pinned pnpm, checked by its npm integrity |

Each script with a `--self-test` mode proves itself in a scratch directory.
