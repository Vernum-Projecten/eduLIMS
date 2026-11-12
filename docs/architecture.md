<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Architecture

eduLIMS is an open-source laboratory information management system (LIMS) for
practical laboratory education. It is one web application with three portals
(student, teacher, administrator) on a shared core. The core keeps teaching
data in its own PostgreSQL database and reads and writes measurement data as
openEHR compositions in FerroEHR.

This document is the design authority. Where it and a later
[decision record](adr/README.md) disagree, the decision record wins.
Requirement IDs refer to [requirements.md](requirements.md), which is a working
draft under re-evaluation. The architecture diagrams will be redrawn once that
re-evaluation is complete; until then this text is the reference.

## Drivers

Two drivers shape the design:

- **Realistic laboratory education.** Students work as in a real lab, where a
  measurement lands in a LIMS without retyping.
- **Long-term continuity.** eduLIMS and its development lane stay
  maintainable by a new maintainer or contributor without prior context.

## Principles

Every design decision can be checked against these principles.

| Principle | Consequence for the design |
|---|---|
| Privacy by design | Measurements come from volunteer subjects: test data, no patient data. Subjects get a pseudonym as EHR subject in FerroEHR. |
| Record once, at the source | Afinion results arrive through HL7; Epoch results through an Excel upload. Nobody retypes a measured value. |
| Open standards | HL7 v2 for the Afinion 2; openEHR archetypes and templates for measurement data. |
| Traceability | Every measurement links through its sample ID to device, sample and student (Q-TRACE-1). |
| Two sides, one system | Separate student and teacher portals on one eduLIMS core. |
| Separate teaching and measurement data | Practicals and assessments in eduLIMS; measurement results in FerroEHR. |
| AI assists, a person decides | No AI-written change without a pull request, green tests and a person who reviews it and takes responsibility for it ([ADR 0009](adr/0009-no-ai-attribution-human-review.md)). |

## Context and integrations

The end-to-end workflow, from the patient to the graded lab report, with its
diagrams and the ownership rules, is in [The LIMS workflow](lims-workflow.md).

eduLIMS integrates with the systems below. An external grade-book system is
out of scope: grading stays in eduLIMS, and teachers can take grades elsewhere
with the CSV export (D6).

| Interface | From → to | Protocol | What is built | Priority |
|---|---|---|---|---|
| Afinion 2 → FerroBRIDGE | analyser → integration layer | HL7 v2 over MLLP (TCP/IP, Ethernet); FerroBRIDGE 0.0.24 accepts MLLP only over TLS with a client certificate per `[[hl7v2.senders]]` entry, and the Afinion 2 has none (Afinion 2 User Manual, 1117346 Rev. A, 2023/02) | configuration: FerroBRIDGE's IP address and port on the device; HL7 to openEHR mapping; waits on the FerroBRIDGE release with address-bound plain MLLP for devices ([FerroBRIDGE#1918](https://github.com/FerroHEALTH/FerroBRIDGE/issues/1918), decided on #131), then that lane bound to the analyser's fixed address, with the port bound to the lab-facing address (`FERROBRIDGE_MLLP_BIND_HOST`) and a host-firewall allow-list of the analysers' fixed addresses ([deployment](deployment.md#the-mllp-port), [ADR 0013](adr/0013-internal-transport-security.md)) | Must |
| FerroBRIDGE → FerroEHR | integration layer → CDR | openEHR REST (ITS-REST 1.1.0) | mapping to the template `eduLIMS-lab` | Must |
| Epoch 2 / Gen5 → eduLIMS | Gen5 PC → web app | Excel file (fixed export template, sample ID per well) | upload, parser and validation in the student portal (S4) | Must |
| eduLIMS → FerroEHR (write) | web app → CDR | openEHR REST, compositions, as the SMART on openEHR backend service `edulims-ferroehr` (client credentials, `system/` scopes) | convert Epoch results to compositions ([ADR 0019](adr/0019-smart-backend-service.md)) | Must |
| eduLIMS → FerroEHR (read) | web app → CDR | AQL 1.1, named stored queries under the same backend-service identity | queries per sample, student and practical ([ADR 0019](adr/0019-smart-backend-service.md)) | Must |
| eduLIMS ↔ identity provider | web app → the institution's identity provider (Microsoft Entra ID or Keycloak) | OpenID Connect, authorization code flow with PKCE | an OIDC client registered by the institution; roles through app roles, groups or realm roles ([ADR 0010](adr/0010-vendor-neutral-oidc-entra-and-keycloak.md)) | Must |
| identity provider → eduLIMS | the institution's directory → web app | SCIM 2.0 (RFC 7644), a bearer token per identity provider | provisioning and deprovisioning of users and groups, roles through the provider's role map ([ADR 0017](adr/0017-scim-provisioning.md)) | not set in the requirements (#45) |
| GitHub → VM | development lane → platform | GitHub Actions, GHCR, Docker Compose | CI/CD with tests and openEHR conformance ([ADR 0002](adr/0002-github-instead-of-azure-devops.md)) | Must |
| eduLIMS → CSV export | web app → teacher | CSV | export of grades (D6) | Should |
| eduLIMS ↔ external grade-book system | | | not built (out of scope) | Won't |

### Two routes from analyser to FerroEHR

| Device | Route | What is built |
|---|---|---|
| Abbott Afinion 2, HbA1c and CRP | sends HL7 v2 itself over Ethernet as plain MLLP; the MLLP listener of FerroBRIDGE 0.0.24 requires TLS with a client certificate, so the route waits on the address-bound plain lane of FerroBRIDGE#1918 (decided on #131) | configuration on the device; FerroBRIDGE's plain lane bound to the analyser's fixed address; on the host, the bind address and the analysers' address allow-list ([deployment](deployment.md#the-mllp-port), [ADR 0013](adr/0013-internal-transport-security.md)) |
| BioTek Epoch 2 | Gen5 3.11 on its own PC exports to Excel; the student uploads the file in the student portal | an upload in eduLIMS that parses the file and writes the results through openEHR REST to FerroEHR |

The Epoch 2 has no direct link and Gen5 does not speak HL7, so the upload is
the simplest route. eduLIMS writes directly to FerroEHR; FerroBRIDGE is only
needed for the Afinion's HL7 messages.

The Gen5 export template must be fixed, preferably as a table with the sample
ID per well (positions A1 to H12). Then eduLIMS can link every measurement to
a student. The parser validates strictly and rejects a file with an unknown
sample ID or an invalid well position (S4, R-06).

### The sample ID

The sample ID is the key that connects every interface. eduLIMS creates it
(S3); the student enters it on the Afinion 2 and puts it in the Gen5 export;
FerroEHR stores it in `CLUSTER.specimen.v1`; the eduLIMS database links it to
the student and the practical.

## Portals and roles

eduLIMS has three roles: `student`, `teacher` and `admin`. A user's role comes
from the identity provider (Entra ID app roles or Keycloak realm roles, by
default `edulims-student`, `edulims-teacher` and `edulims-admin`), mapped
through configuration ([ADR 0010](adr/0010-vendor-neutral-oidc-entra-and-keycloak.md)),
and is enforced on the server for every request (Q-SEC-1, Q-SEC-2).

| Role | Portal | May | Sees |
|---|---|---|---|
| Student | Student portal (`/student`) | register samples, upload Excel, submit the lab report | own practicals, own measurements, own grade next to the class and practical average |
| Teacher | Teacher portal (`/teacher`) | set up practical, protocol and rubric; link classes; check results; grade; record feedback and grade | all students, submissions and measurements of their own practicals; KPI dashboard of their own classes |
| Administrator | Admin portal (`/admin`) | manage users, classes and roles; manage analysers and the FerroEHR and FerroBRIDGE integrations | logs, integration status, analyser usage |

A user may hold teacher and administrator together; student is never combined
with another role. The roles are a set, not a ranking: each one keeps only
its own access. The portal is the first path segment, and the portal
switcher at the top of the sidebar moves between the portals a user holds;
the last one picked is the landing page at the next sign-in
([ADR 0012](adr/0012-multiple-roles-and-portal-switcher.md)).

"View measurement results" is the same application service for student and
teacher with a different scope: the teacher sees all students of their
practical, the student only their own work.

### Core process

1. The teacher sets up a practical (assignment, protocol, rubric, deadline).
2. The student registers samples and receives sample IDs.
3. The student measures on the Afinion 2 (the result goes to FerroEHR on its
   own) or on the Epoch 2 and uploads the Excel export.
4. The student checks the results and submits the lab report. The submission
   is then locked (S6).
5. The teacher grades with the rubric and records feedback and grade.
6. The student sees feedback and grade; the KPI dashboard updates.

## Data

eduLIMS uses two databases on one PostgreSQL 18 server. Grades stay out of the
CDR on purpose: they belong to real students, while the CDR only holds
pseudonyms of volunteer subjects, and this way no custom archetypes are
needed.

| Database | Holds | Read with |
|---|---|---|
| FerroEHR (openEHR CDR) | sample and measurement result as an openEHR composition (template `eduLIMS-lab`, existing CKM archetypes); a pseudonym as EHR subject | openEHR REST, AQL |
| eduLIMS database | users, roles and classes; practicals (assignment, protocol, rubric, deadline); sample IDs linked to student and practical; lab reports; assessments, grades and feedback; upload log and audit log; better-auth's sessions and accounts | SQL through Kysely ([ADR 0006](adr/0006-kysely-for-app-data.md)) |

Each database has its own database user. One server keeps monitoring and
backup simple: one backup routine covers both.

Classes are better-auth organizations and lab groups are teams inside them
([ADR 0018](adr/0018-classes-as-organizations.md)): the plugin owns the
tables and the class roles (`owner`, `teacher`, `student`), and eduLIMS's
class service (`src/server/classes/`) does every write behind a membership
check on the session user, with the plugin's own endpoints unreachable. A
person joins every class that invited their verified email when they sign
in; eduLIMS sends no email. A student who signs in with another address joins
with the class's join code (#49) instead: eduLIMS's own `class_join_codes`
table keeps one HMAC of the code per class with its term, its number of joins
and the fingerprint of its key. Every attempt is counted per student and per
client IP (only through `EDULIMS_TRUSTED_PROXIES`) in `class_join_attempts`,
one atomic upsert per key before the lookup, so parallel requests, restarts
and replicas share the count; a join takes its count back. A student a
teacher removes is recorded in `class_removals`, their pending invitations to
the class are revoked in the same transaction, and they cannot rejoin with the
code until a new invitation or a re-add clears the record.

### Template `eduLIMS-lab`

The operational template `eduLIMS-lab.v1` is built only from existing
archetypes from the openEHR Clinical Knowledge Manager (CKM). eduLIMS adds no
archetype of its own. It is an OPT 1.4 file,
`docker/ferroehr/definitions/eduLIMS-lab.v1.opt`, that
`scripts/openehr/build-opt.py` builds from the CKM's XML of each archetype at
the revision it pins, and FerroEHR loads it before it serves
([deployment](deployment.md#ferroehrs-templates)). A changed template is a
new id (`eduLIMS-lab.v2`), because FerroEHR never replaces a stored template.

| Archetype | CKM revision | Where it sits | What it records |
|---|---|---|---|
| `openEHR-EHR-COMPOSITION.report-result.v1` | 1.1.0 | the root | the result report as a whole; its context has no element for the practical |
| `openEHR-EHR-OBSERVATION.laboratory_test_result.v1` | 1.2.8 | `content`, one or more | the test, and the order in its protocol |
| `openEHR-EHR-CLUSTER.specimen.v1` | 1.1.3 | the observation's "Specimen detail" slot, one or more | the sample: sample ID and well position |
| `openEHR-EHR-CLUSTER.laboratory_test_analyte.v1` | 1.2.3 | the observation's "Test result" slot, one or more | per analyte the name, the value with its unit and the result status |
| `openEHR-EHR-CLUSTER.device.v1` | 1.1.6 | the observation's "Testing details" slot (protocol), exactly one | the analyser |

The specimen, analyte and device clusters are slots inside the observation,
not entries beside it. The template fills those three slots and closes every
other slot of the five archetypes, so no other archetype can enter a
composition.

Where each eduLIMS field goes (decided by the maintainer on the owner's
delegation on #146, within the CKM archetypes, W4):

| eduLIMS field | Archetype | Element (at-code) | Data type | In the template |
|---|---|---|---|---|
| Sample ID | `specimen.v1` | Laboratory specimen identifier (`at0001`) | `DV_IDENTIFIER` | required, one |
| Well position (Epoch 2) | `specimen.v1` | Specimen label (`at0098`) | `DV_TEXT` | optional |
| Practical | `laboratory_test_result.v1` | Test request details (`at0094`), Requester order identifier (`at0062`) | `DV_IDENTIFIER` | optional |
| Test name | `laboratory_test_result.v1` | Test name (`at0005`) | `DV_TEXT` | required, as in the archetype |
| Analyte name; for the Epoch 2 it includes the wavelength | `laboratory_test_analyte.v1` | Analyte name (`at0024`) | `DV_TEXT` | required, one |
| Value and unit | `laboratory_test_analyte.v1` | Analyte result (`at0001`) | `DV_QUANTITY` (`magnitude`, `units`; `magnitude_status` for a value outside the measuring range) | required, one |
| Result status | `laboratory_test_analyte.v1` | Result status (`at0005`) | `DV_CODED_TEXT`, local `at0017` Preliminary or `at0018` Final | required, one |
| Analyser | `device.v1` | Device name (`at0001`), Serial number (`at0020`), Other identifier (`at0024`) | `DV_TEXT`, `DV_TEXT`, `DV_IDENTIFIER` | Device name required, as in the archetype |
| Lab (facility) | the reference model | `COMPOSITION.context.health_care_facility` | `PARTY_IDENTIFIED` with the identifier of the system client's facility | FerroEHR refuses a composition without it |
| Composer | the reference model | `COMPOSITION.composer` | `PARTY_IDENTIFIED` naming the analyser, its serial number as identifier under the issuer `https://edulims.eu/id/analyser` | FerroEHR checks it for the `device` origin |

An unchecked student result has the status Preliminary; the student's
release makes it Final ([LIMS workflow](lims-workflow.md)). The Afinion 2
analytes, HbA1c and CRP, are fixed by the device. The Epoch 2 assays stay
generic, an analyte name and a value per well and wavelength, until the
practical questions on #131 are answered. No element carries a name, a
student number or an email address (Q-PRIV-1); who the EHR subject is waits
on #131 (X1).

Every composition eduLIMS writes passes openEHR validation against this
template (Q-COMP-1).

### Reporting

The KPI dashboard is built inside eduLIMS rather than in an external BI tool:
the database runs on the institution's own server, and nested openEHR
compositions are hard to report on in a generic BI tool. Grade KPIs use SQL on
the assessment records; measurement quality and analyser usage use AQL on
FerroEHR. The analytical model is a star schema with three fact tables
(submission, assessment, measurement) and dimensions for student, class,
practical, rubric criterion and date. Details are in
[kpi-dashboard.md](kpi-dashboard.md).

## Application structure

| Concern | Choice | Record |
|---|---|---|
| Web framework | TanStack Start with full server-side rendering on Vite, served by a Nitro Node server | [ADR 0003](adr/0003-tanstack-start-full-ssr-on-vite.md) |
| Language | TypeScript 7 native compiler; Biome for lint and format | [ADR 0004](adr/0004-typescript-7-native-compiler.md) |
| Sign-in and sessions | better-auth with Microsoft Entra ID or Keycloak, PostgreSQL adapter through Kysely | [ADR 0005](adr/0005-better-auth-entra-id.md), [ADR 0010](adr/0010-vendor-neutral-oidc-entra-and-keycloak.md) |
| Application data access | Kysely with `pg` | [ADR 0006](adr/0006-kysely-for-app-data.md) |
| Runtime and package manager | Node.js 26 LTS, pnpm 12 | [ADR 0007](adr/0007-node-26-lts-and-pnpm-12.md) |
| Code language and UI text | English code; all UI text through the i18n layer (English source, Dutch translation) | ADR 0011 |

Server functions in TanStack Start hold the business rules and the access
checks; route loaders call them. FerroEHR is called only from the server, so
the browser never talks to the CDR.

One typed openEHR client in `src/server/openehr/` makes every FerroEHR call
(ITS-REST 1.1.0); a unit test fails when another module reads a FerroEHR
setting or names an openEHR path. It signs in as eduLIMS's own FerroEHR
identity: an OAuth2 client credentials grant (RFC 6749 §4.4) at
`FERROEHR_TOKEN_URL` for the `system/` scopes in `FERROEHR_SCOPE`, with the
token cached until 30 seconds before it expires and fetched again once when
FerroEHR answers `401`. FerroEHR issues no tokens and holds `system/` scopes
for no Basic user, so Basic is not used. Every call has a timeout, follows no
redirect, reads a capped body and returns a typed result (unreachable,
timeout, refused authentication with its reason, refused by FerroEHR with the
status and the openEHR error code, or an unusable answer). The client logs
nothing, and its errors carry no token, secret, URL or body.

Work that has to happen on a schedule runs inside the app container as a Nitro
runtime plugin, because operators run only the images and no host cron job.
The integration check of B3 is the first: every 60 seconds the server checks
FerroEHR in three steps through the openEHR client, and FerroBRIDGE with
`GET /health/readiness`, both from configuration only. FerroEHR is reachable
when `OPTIONS` on its base URL (the System API of ITS-REST 1.1.0, without a
credential) answers its manifest, signed in when eduLIMS obtains a token and
lists the templates with it (Definition API), and ready when `eduLIMS-lab.v1`
is in that list; a later step is skipped after a failed one. A FerroBRIDGE
`503` with its readiness document names the indicators that are not up. The
server stores the latest result per integration, with each step, the version
codes and a refusal's reason code (`integration_checks`), and writes an
`integration_state_changed` row to the activity log when the state, its class
or the failed step changes. A PostgreSQL advisory lock and the age of the last
result make one replica check per interval. The Admin portal reads the stored
result and refetches it every 30 seconds, so an unreachable service shows
within the 5 minutes of B3.

## Deployment

Two places carry the system:

- **The practical lab.** Each Epoch 2 has its own PC with Gen5 3.11, connected
  over USB. The Afinion 2 is on the lab network over Ethernet, and the lab
  network routes to the server network. The sample ID is on the physical
  sample, which closes the traceability chain.
- **A Linux VM in an isolated network of the institution.** All parts run as
  containers through Docker Compose
  ([ADR 0008](adr/0008-docker-compose-ghcr-slsa.md)).

| Container | Role in this project |
|---|---|
| eduLIMS (web app and backend) | built here |
| FerroEHR | configured: the template `eduLIMS-lab` is loaded with `ferroehr definitions load` before `serve`; not developed here |
| FerroBRIDGE | configured: MLLP listener (TLS with client certificates in 0.0.24; the Afinion 2 waits on FerroBRIDGE#1918) and HL7 to template mapping; not developed here |
| PostgreSQL 18 | one server, two databases: FerroEHR's and eduLIMS's |

Images are built in GitHub Actions, pushed to GHCR with SLSA Build Level 3
provenance, and pulled onto the VM with `docker compose pull`. Docker Compose
also keeps a move to a cloud environment open. If hosting moves to Azure, a
managed PostgreSQL in an EU region replaces the database container and the
FerroEHR plus eduLIMS database split stays the same.

[ci-cd.md](ci-cd.md), [release.md](release.md) and
[deployment.md](deployment.md) describe the lane.

### Development lane

| Step | Who | Supported by |
|---|---|---|
| Specify the need | product owner | an issue in GitHub |
| AI-assisted development | developer | Claude Code, with `CLAUDE.md` and the rules as context |
| Code review by a person | reviewer | GitHub pull requests |
| Automated tests and conformance | pipeline | GitHub Actions: tests plus openEHR conformance |
| Release and roll out | maintainer | GHCR and `docker compose pull` on the VM |
| Operate and monitor | maintainer, administrator | the Linux VM (Docker Compose) |

## Quality requirements

The full list with acceptance criteria is in
[requirements.md](requirements.md#quality-requirements). The ones that shape
the architecture:

| ID | Requirement | Where the architecture answers it |
|---|---|---|
| Q-SEC-1, Q-SEC-2 | SSO only; access per role, filtered on own data | Entra ID or Keycloak through better-auth; role and ownership checks in server functions; no client-side access to FerroEHR |
| Q-SEC-3 | HTTPS; measurement data stays inside the institution's network | everything on one VM in an isolated network; TLS terminated in front of the app ([deployment.md](deployment.md)) |
| Q-PRIV-1, Q-PRIV-2 | pseudonyms only in the CDR; averages from 5 assessments | data split between CDR and eduLIMS database; threshold in the KPI queries |
| Q-TRACE-1 | measurement traceable to device, sample and student | sample ID across all interfaces |
| Q-PERF-1, Q-PERF-2 | pages within 2 s; upload within 10 s | server rendering; parsing and validation on the server, one REST write per composition |
| Q-REL-1 | 99% of practical hours; recovery within one working day | Compose stack restarts; one backup routine for both databases |
| Q-ACC-1 | WCAG 2.1 AA | shadcn/ui on Radix primitives; axe in Playwright tests |
| Q-MAINT-1 | core coverage at least 70%; docs current | Vitest coverage gate; this document in the Definition of Done |
| Q-SUST-1 | one environment, no idle services | one VM, one Compose file |
| Q-COMP-1 | HL7 v2, openEHR REST and AQL | FerroBRIDGE for HL7; template validation in FerroEHR |
