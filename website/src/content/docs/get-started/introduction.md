---
title: Introduction
description: What eduLIMS is, who uses it, and where it stands.
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

eduLIMS is an open-source laboratory information management system (LIMS) for
practical laboratory education. Students register samples, run measurements
on the lab analysers, check their results and submit a lab report. Teachers
set up a practical, grade it with a rubric and follow their classes on a KPI
dashboard. Administrators manage users and roles and watch the integrations.

Measurement data is stored as openEHR compositions in
[FerroEHR](https://github.com/FerroHEALTH/FerroEHR), an openEHR clinical data
repository. Results from analysers that send HL7 v2 arrive through
[FerroBRIDGE](https://github.com/FerroHEALTH/FerroBRIDGE). Everything about
teaching and grading (practicals, sample IDs, lab reports, rubric scores and
grades) stays in the eduLIMS database.

:::caution[Pre-release]
eduLIMS is pre-release software. The [requirements](/development/requirements/)
are a working draft under re-evaluation, and the application, its
configuration and this documentation can change between releases without a
deprecation period. eduLIMS holds only test data from volunteer subjects
under a pseudonym; it is not meant for patient data.
:::

## Portals and roles

eduLIMS has three portals, one per role. A user has one role, and every
server function checks the role and the ownership of the data it reads, so a
page shows only what that role may see. The Dutch portal names are in
brackets.

| Portal                          | Role      | Guide                                         |
| ------------------------------- | --------- | --------------------------------------------- |
| Student portal (Studentportaal) | `student` | [Student guide](/guides/student/)             |
| Teacher portal (Docentportaal)  | `teacher` | [Teacher guide](/guides/teacher/)             |
| Admin portal (Beheerportaal)    | `admin`   | [Administrator guide](/guides/administrator/) |

Users sign in through OpenID Connect, with Microsoft Entra ID, Keycloak, or
both. The identity provider supplies the role in a claim, which eduLIMS maps
to one of the three roles ([Identity providers](/operations/identity-providers/)).

## The stack

| Layer            | Choice                                                                              |
| ---------------- | ----------------------------------------------------------------------------------- |
| Runtime          | Node.js 26 LTS, pnpm 12                                                             |
| Application      | TanStack Start (full server-side rendering) on Vite 8, React 19                     |
| Language         | TypeScript 7 (native compiler)                                                      |
| Sign-in          | better-auth with Microsoft Entra ID or Keycloak (OpenID Connect, PKCE)              |
| Database         | PostgreSQL 18 through Kysely                                                        |
| Measurement data | FerroEHR (openEHR REST and AQL), FerroBRIDGE (HL7 v2 over MLLP)                     |
| Delivery         | Docker Compose on one Linux host, images on GHCR with SLSA Build Level 3 provenance |

The exact versions are in [Versions](/development/versions/), and the reasons
behind each choice are in the [decision records](/development/decisions/).

## Where to go next

- To run eduLIMS on your machine, follow the [quick start](/get-started/quick-start/).
- To use eduLIMS, read the guide for your role.
- To deploy it, follow [Install with Docker Compose](/operations/install/) and
  the [configuration reference](/operations/configuration/).
- To understand the design, read the [architecture](/development/architecture/).
- To contribute, read [Contributing](/development/contributing/).
