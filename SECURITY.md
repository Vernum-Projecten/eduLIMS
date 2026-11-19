<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Security policy

eduLIMS is an open-source laboratory information management system (LIMS) for
a workplace simulation in laboratory education. A deployment runs on one
Linux VM inside the institution's network. It holds the accounts of students
and teachers, the fictional patients of the simulations with their results, and the
correct values a teacher enters for a simulation, which students must never see.

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

**Never include personal data in a report.** Not a real name, student number
or measurement of a real person, and nothing from a real simulation (a scenario or
a correct value). Use the pseudonymised test set or make up an equivalent
case.

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
the maintainer also informs the product owner and the institution's privacy
officer, so that the institution can decide on a data breach notification
under the GDPR.

## Scope

In scope:

- the eduLIMS application: sign-in and session handling, role checks
  (a student who sees the work of another team, a correct value or an
  accuracy status is a vulnerability), the Excel upload and parser, the CSV
  import, and the API routes;
- the container image, the Compose files and the CI/CD workflows in this
  repository.

Out of scope, and reported to their own projects:

- FerroEHR and FerroBRIDGE;
- the identity provider (Microsoft Entra ID or Keycloak) and the institution's network;
- the Gen5 software and the analysers.

## Verifying a release

Each release image is built in GitHub Actions with SLSA Build Level 3
provenance. Verify an image with:

```sh
gh attestation verify oci://ghcr.io/vernum-projecten/edulims:<tag> \
  --repo Vernum-Projecten/eduLIMS
```

[docs/release.md](docs/release.md) describes the release lane; the published
documentation is at <https://edulims.eu/>.
