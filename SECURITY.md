<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Security policy

eduLIMS is a student project for the research group New Business & ICT at
Hanze. It runs on one Linux VM inside a Hanze network and holds test data from
volunteer subjects under a pseudonym, plus the grades of students taking part
in the practical courses.

## Supported versions

Only the newest release and `main` receive fixes. There are no maintenance
branches and no backports.

| Artifact | Supported |
|---|---|
| The container image `ghcr.io/vernum-projecten/edulims` | the newest release tag |
| The source on `main` | best effort |

## Reporting a vulnerability

**Do not open a public issue for a security vulnerability.** Report it through
[GitHub private vulnerability reporting](https://github.com/Vernum-Projecten/eduLIMS/security/advisories/new)
("Report a vulnerability" on the repository's Security tab). Describe the
issue, the affected version or commit, and a reproduction if you have one.

**Never include personal data in a report.** Not a real name, student number,
grade or measurement of a real person. Use the pseudonymised test set or make
up an equivalent case.

## What happens next

The project has one maintainer, so these times are best effort:

- an acknowledgement within 5 working days;
- an assessment (valid or not, and how severe) within 10 working days;
- a fix in a new release, as soon as it is ready. A critical issue on a
  running deployment is first contained, for example by taking the affected
  route or container offline.

A confirmed vulnerability gets a GitHub security advisory on this repository.
It is published together with the release that fixes it.

If a vulnerability could have exposed personal data of students or teachers,
the maintainer also informs the client and the Hanze privacy officer, so that
Hanze can decide on a data breach notification under the GDPR (AVG).

## Scope

In scope:

- the eduLIMS application: sign-in and session handling, role checks
  (a student who sees another student's grades or results is a vulnerability),
  the Excel upload and parser, the CSV export, and the API routes;
- the container image, the Compose files and the CI/CD workflows in this
  repository.

Out of scope, and reported to their own projects:

- FerroEHR and FerroBRIDGE;
- Microsoft Entra ID and the Hanze network;
- the Gen5 software and the analysers.

## Verifying a release

Each release image is built in GitHub Actions with SLSA Build Level 3
provenance. Verify an image with:

```sh
gh attestation verify oci://ghcr.io/vernum-projecten/edulims:<tag> \
  --repo Vernum-Projecten/eduLIMS
```

[docs/release.md](docs/release.md) describes the release lane.
