<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Architecture

eduLIMS is an open-source laboratory information management system (LIMS) for
a workplace simulation in laboratory education. Each team of students runs a
simulated clinical laboratory, its lab: the team registers patients and
requests from paper forms, links the samples, measures, and releases each
result to the patient's record. Teachers follow every lab on a live dashboard
([ADR 0020](adr/0020-workplace-simulation.md),
[ADR 0021](adr/0021-simulations-and-labs.md)). eduLIMS is one web application
with three portals (student, teacher, administrator) on a shared core. The
core keeps the data of a simulation in its own PostgreSQL database and reads
and writes measurement data as openEHR compositions in FerroEHR.

This document is the design authority. Where it and a later
[decision record](adr/README.md) disagree, the decision record wins.
Requirement IDs refer to [requirements.md](requirements.md), which is a working
draft. Its [open questions](requirements.md#open-questions) (O1 to O14) are
answered or decided, except O1 (time targets and urgent requests) and O3 (the
ranking), which the owner holds for the next iteration; nothing is built for
those two. A point marked **Open** names an engineering point that an issue
still settles. The architecture diagrams will be redrawn; until then this
text is the reference.

## Drivers

Two drivers shape the design:

- **Realistic laboratory education.** Teams work as in a real clinical lab
  and follow the chain a real LIMS follows: patient, request, sample,
  measurement, release.
- **Long-term continuity.** eduLIMS and its development lane stay
  maintainable by a new maintainer or contributor without prior context.

## Principles

Every design decision can be checked against these principles.

| Principle | Consequence for the design |
|---|---|
| Privacy by design | The patients of a simulation are fictional (W5). The patient's record in FerroEHR carries the fictional details the team registers (S11, O9). No student or teacher is ever an EHR subject, and no name, student number or email address of a student or a teacher reaches FerroEHR (Q-PRIV-1). |
| Record once, at the source | Afinion results arrive through HL7; Epoch values through an Excel upload. Per test the teacher sets the source in the test catalogue: the Afinion 2, the Epoch 2 upload, or entry by hand; a result calculated from other results is a test with entry by hand (D9). |
| Open standards | HL7 v2 for the Afinion 2; openEHR archetypes and templates for measurement data. |
| Traceability | Every measurement links through its sample number to device, sample, patient and team (Q-TRACE-1). |
| The students are the analysts | eduLIMS gives a student no hint (W7): no screen and no server response for a student holds a correct value, an accuracy status or another team's work (Q-SIM-1). The one check is the warning against the team's own tolerance (S15). |
| The server keeps the time | Every time the dashboard uses is taken on the server (Q-SIM-2). |
| Two sides, one system | Separate student and teacher portals on one eduLIMS core. |
| Separate simulation and measurement data | Simulations, labs, correct values, tolerances and times in eduLIMS; results in FerroEHR. |
| AI assists, a person decides | No AI-written change without a pull request, green tests and a person who reviews it and takes responsibility for it ([ADR 0009](adr/0009-no-ai-attribution-human-review.md)). |

## Context and integrations

The end-to-end workflow, from the paper request form to the result in the
patient's record and on the teacher's dashboard, with its diagrams and the
ownership rules, is in [The LIMS workflow](lims-workflow.md).

eduLIMS integrates with the systems below. An external grade-book system is
out of scope: eduLIMS holds no grades (W2, W6).

| Interface | From → to | Protocol | What is built | Priority |
|---|---|---|---|---|
| Afinion 2 → FerroBRIDGE | analyser → integration layer | HL7 v2 over MLLP (TCP/IP, Ethernet); FerroBRIDGE 0.0.24 accepts MLLP only over TLS with a client certificate per `[[hl7v2.senders]]` entry, and the Afinion 2 has none (Afinion 2 User Manual, 1117346 Rev. A, 2023/02) | configuration: FerroBRIDGE's IP address and port on the device; HL7 to openEHR mapping; waits on the FerroBRIDGE release with address-bound plain MLLP for devices ([FerroBRIDGE#1918](https://github.com/FerroHEALTH/FerroBRIDGE/issues/1918), decided on #131), then that lane bound to the analyser's fixed address, with the port bound to the lab-facing address (`FERROBRIDGE_MLLP_BIND_HOST`) and a host-firewall allow-list of the analysers' fixed addresses ([deployment](deployment.md#the-mllp-port), [ADR 0013](adr/0013-internal-transport-security.md)) | Must |
| FerroBRIDGE → FerroEHR | integration layer → CDR | openEHR REST (ITS-REST 1.1.0) | mapping to the template `eduLIMS-lab` | Must |
| Epoch 2 / Gen5 → eduLIMS | Gen5 PC → web app | Excel file (the Gen5 export: a header block and a 96-well grid of absorbance values at one wavelength) | upload by drag and drop, parser and layout validation in the student portal; eduLIMS loads the values and shows the plate, and the team links wells to samples (S4); per test the teacher chooses in the test catalogue whether the team calculates the concentration or eduLIMS does (D9, O5) | Must |
| eduLIMS → FerroEHR (write) | web app → CDR | openEHR REST, compositions, as the SMART on openEHR backend service `edulims-ferroehr` (client credentials, `system/` scopes) | write a released result to the patient's record as a composition (S15, [ADR 0019](adr/0019-smart-backend-service.md)); a released result is final (S15); where a measurement lives before its release is a design matter, with the proposal in [The LIMS workflow](lims-workflow.md#who-owns-what-and-where-it-lives) | Must |
| eduLIMS → FerroEHR (read) | web app → CDR | AQL 1.1, named stored queries under the same backend-service identity | queries for the measurements of a team's samples (S5, [ADR 0019](adr/0019-smart-backend-service.md)); a result finds its team through the lab number the team enters as the patient ID on the analyser (S5, S12) | Must |
| eduLIMS ↔ identity provider | web app → the institution's identity provider (Microsoft Entra ID or Keycloak) | OpenID Connect, authorization code flow with PKCE | an OIDC client registered by the institution; roles through app roles, groups or realm roles ([ADR 0010](adr/0010-vendor-neutral-oidc-entra-and-keycloak.md)) | Must |
| identity provider → eduLIMS | the institution's directory → web app | SCIM 2.0 (RFC 7644), a bearer token per identity provider | provisioning and deprovisioning of users and groups, roles through the provider's role map ([ADR 0017](adr/0017-scim-provisioning.md)) | not set in the requirements (#45) |
| GitHub → VM | development lane → platform | GitHub Actions, GHCR, Docker Compose | CI/CD with tests and openEHR conformance ([ADR 0002](adr/0002-github-instead-of-azure-devops.md)) | Must |
| eduLIMS ↔ external grade-book system | | | not built: eduLIMS holds no grades (W2, W6) | Won't |

### Two routes from analyser to FerroEHR

| Device | Route | What is built |
|---|---|---|
| Abbott Afinion 2, HbA1c and CRP | sends HL7 v2 itself over Ethernet as plain MLLP; the MLLP listener of FerroBRIDGE 0.0.24 requires TLS with a client certificate, so the route waits on the address-bound plain lane of FerroBRIDGE#1918 (decided on #131) | configuration on the device; FerroBRIDGE's plain lane bound to the analyser's fixed address; on the host, the bind address and the analysers' address allow-list ([deployment](deployment.md#the-mllp-port), [ADR 0013](adr/0013-internal-transport-security.md)) |
| BioTek Epoch 2 | Gen5 3.11 on its own PC exports to Excel; the team drops the file on the upload area in the student portal | an upload in eduLIMS that reads the file and shows its values to the team (S4); eduLIMS writes the released result through openEHR REST to FerroEHR (S15) |

The Epoch 2 has no direct link and Gen5 does not speak HL7 (W3), so the upload
is the simplest route. eduLIMS writes directly to FerroEHR; FerroBRIDGE is
only needed for the Afinion's HL7 messages.

The Gen5 export is one sheet: a header block and a 96-well grid, rows A to H
and columns 1 to 12, of absorbance values at one wavelength. It holds no
sample number, no plate layout and no concentration. The parser validates the
layout strictly and rejects a file in another layout with a clear message
(S4); [The Gen5 export contract](gen5-export.md) pins the layout, the file
limits and the refusals. eduLIMS loads the 96 values and shows the plate, as a real LIMS does,
and the team says which well holds which sample (owner, 2026-11-19, O5,
R-06). Who calculates the concentration is the teacher's choice per test in the
test catalogue (D9): the team, by its own procedure, or eduLIMS, from the
standards and blanks the team marked on the plate. When eduLIMS calculates,
it subtracts the blank and fits a straight line through the standards. A
sample outside the range of the standards gets no number but the message
that it is outside the range (S4; owner, 2026-11-19, O5).

### The sample number and the lab number

The sample number is printed on the paper request form, and eduLIMS never
creates one. The team records it with the request (S12); the eduLIMS
database links it to the request, the patient and the team.

Every team works the same sample numbers, so the number alone does not say
whose result an analyser sends (R-11). When the team records a sample,
eduLIMS gives it a lab number that is unique across the teams of every simulation
(S12). The team enters that lab number as the patient ID on the Afinion 2,
and the result finds its team through it (owner, 2026-11-19, O13; S5). The
lab number is the key that connects the analyser route to the team's sample.
It is ten decimal digits, the last a check digit by the Damm algorithm (#268).
The analyser sends the entered patient ID, so the lab number, in PID-3 or
PV1-19 (Afinion 2 HL7 Connectivity Protocol v4.0, §3.5 and §3.6, vendored in
`docs/vendor/afinion/`); which element of the composition carries the lab
number beside the sample number is settled in #160. A result that eduLIMS cannot link to a team's sample is
never attached to one: it is logged and shown to administrators (#163).

## Portals and roles

eduLIMS has three roles: `student`, `teacher` and `admin`. A user's role comes
from the identity provider (Entra ID app roles or Keycloak realm roles, by
default `edulims-student`, `edulims-teacher` and `edulims-admin`), mapped
through configuration ([ADR 0010](adr/0010-vendor-neutral-oidc-entra-and-keycloak.md)),
and is enforced on the server for every request (Q-SEC-1, Q-SEC-2).

| Role | Portal | May | Sees |
|---|---|---|---|
| Student | Student portal (`/student`) | with the team: register patients, record requests and samples, set tolerances, upload the Epoch export, measure again, release results | the work of their own team only; never a correct value, an accuracy status or another team's work |
| Teacher | Teacher portal (`/teacher`) | manage the test catalogue, prepare a simulation with its labs (name, logo and the members' email addresses) and its correct values, add other teachers to it, set the accuracy limits, follow the teams | every lab of their own simulations (the ones they created or were added to): times, measurements, released results, accuracy, and the teams' tolerances with their changes |
| Administrator | Admin portal (`/admin`) | manage users and roles; manage analysers and the FerroEHR and FerroBRIDGE integrations | logs, integration status, analyser usage; the simulations with their teachers, their labs and the number of members, read-only, and nothing of a lab's work and no correct value (B5, a Should) |

A user may hold teacher and administrator together; student is never combined
with another role. The roles are a set, not a ranking: each one keeps only
its own access. The portal is the first path segment, and the portal
switcher at the top of the sidebar moves between the portals a user holds;
the last one picked is the landing page at the next sign-in
([ADR 0012](adr/0012-multiple-roles-and-portal-switcher.md)).

The work belongs to the lab. Every patient, request, sample, measurement and
result hangs under the lab within a simulation, and every server function
checks that in its database query (S10). A teacher creates each lab with the
name and the logo its team made up, and eduLIMS shows the lab under them
(D10, S10). The labs of a simulation compete with each other. A teacher sees
the labs of their own simulations. A teacher can add other teachers to a
simulation, and they get the same rights (D10).

Every student signs in with their own account. A student who signs in with an
email address a teacher added to a lab is linked to that lab without doing
anything; eduLIMS sends no email. A student who signs in with another address
joins with the lab's code (S10; owner, 2026-11-19, O10). There are no roles
inside a lab: every member may do everything, and eduLIMS records who did
what. A student can be in several simulations, in one lab of each (S10).

Only functions for the teacher role read a correct value or an accuracy
status, and each has negative tests with a student account (Q-SIM-1).

### Core process

1. Before a simulation, the teacher manages the test catalogue (D9) and
   prepares the simulation: its name, its labs with their names, logos and
   the email addresses of their members, and the correct value per test and
   sample number, once per simulation and for every lab (D10). The teacher
   also sets, per test, the limits for yellow and red, each as a percentage
   of the correct value or as an absolute distance (D13). A teacher can
   change a correct value before, during and after the simulation; the
   change is logged and the dashboard follows it (D10). A time target for
   urgent requests is not built in this iteration (D12, O1). Copying a
   simulation, with its correct values and without its labs, is a Could
   (D15).
2. The team sets its own tolerance, a lower and an upper limit, per test
   (S13). It can change a tolerance during the simulation; every change is
   logged and the teacher sees it.
3. The team registers a patient from the paper request form (S11) and records
   the request: the tests and each sample by its sample number and material
   (S12). eduLIMS records the time of entry on the server and gives each
   sample its lab number; the same sample number twice in a lab gets two lab
   numbers. Until the first result is released, the team can correct a
   patient or a request; every correction is logged for the teacher, and the
   time of entry never changes (S11, S12). A control sample, which has no
   patient, is its own kind of request: the team records it without a
   patient (S16).
4. The team measures on the Afinion 2, where it enters the lab number as the
   patient ID (the result goes to FerroEHR on its own), or on the Epoch 2,
   after which it uploads the Excel export (S4, S5). A team can measure
   again; every measurement is kept (S14).
5. The team picks a measurement and releases it to the patient's record.
   eduLIMS warns when the value is outside the team's own tolerance, and
   records the time of release on the server (S15). A result can be released
   only for a test with a tolerance, and eduLIMS keeps the tolerance in force
   at the release (S13, S15). A released result is
   final. The result of a control request goes to the control log of the
   team, never to a patient's record (S16).
6. The teacher's dashboard shows the request with its times, every
   measurement of a requested test with the released one marked, and the
   accuracy of the released result, without a manual reload (D11, D13).

## Data

eduLIMS uses two databases on one PostgreSQL 18 server. Everything that
belongs to the simulation itself stays out of the CDR on purpose: a correct value, a
tolerance and an accuracy status are not part of a patient's record, and this
way no custom archetypes are needed (W4). The CDR also holds no name, student
number or email address of a student or a teacher, and no student or teacher
is an EHR subject (Q-PRIV-1).

| Database | Holds | Read with |
|---|---|---|
| FerroEHR (openEHR CDR) | one EHR per patient a team registers, its subject the patient's eduLIMS id (S11); each result as an openEHR composition (template `eduLIMS-lab`, existing CKM archetypes) in the EHR of its patient, with the sample number, the analyte, the value, the device and the time | openEHR REST, AQL |
| eduLIMS database | users and roles; simulations and their labs, each with its name, its logo and its members; the test catalogue; correct values; tolerances; patients, requests and samples with their lab numbers; the times of entry and release; upload log and audit log; better-auth's sessions and accounts | SQL through Kysely ([ADR 0006](adr/0006-kysely-for-app-data.md)) |

The EHR subject is the fictional patient, named by its eduLIMS id; a
fictional patient gets no pseudonym (owner, 2026-11-19, O9). The details the
team registers stay in the eduLIMS database for now
([The EHR of a patient](#the-ehr-of-a-patient)). A result released to the patient's record is final: nobody
can change it or release another measurement for that requested test (S15;
owner, 2026-11-19, O7). Where a measurement lives before its release is a
design matter for the maintainer; the proposal is under
[Template `eduLIMS-lab`](#template-edulims-lab).

A control request has no patient, so its released result is in no patient's
record: it goes to the control log of the team (S16; owner, 2026-11-19,
O14). The release of a control result lives in the eduLIMS database, like
every release, and is never written to FerroEHR (#270); the control log is
the lab's released control results. Whether an Afinion 2 control run that
arrives with `Q` in MSH-11 joins it is settled in #160.

The correct values of a simulation are entered once, keyed by sample number
and test, and hold for every lab (D10). Adding or removing a lab changes no
correct value.

Each database has its own database user. One server keeps monitoring and
backup simple: one backup routine covers both.

### The EHR of a patient

Every patient a team registers gets its own EHR in FerroEHR (S11, #147).
The subject of the EHR is the patient's eduLIMS id, never the patient ID
printed on the form: the teams of a simulation work the same forms, and two
teams that register the same patient must get two EHRs, or one would read the
other's results (S10). The first `EHR_STATUS` names the subject as a
`PARTY_SELF` whose `external_ref` is a `PARTY_REF` of type `PERSON`, with the
namespace `edulims-patient` and the patient id as its `HIER_OBJECT_ID` (RM
common 1.1.0, "Referring to the Patient"). It carries no name, no lab, no
simulation and nothing about a student or a teacher (Q-PRIV-1). The namespace
is a constant in `src/server/openehr/ehr.ts`; no openEHR specification
governs its value.

The form's details (name, date of birth, sex and patient ID) are not written
to FerroEHR yet. `PARTY_SELF` carries no details, and the openEHR model puts
them in a demographic service the `external_ref` points at, which in FerroEHR
is the DEMOGRAPHIC API (a `PERSON`, open to a client only through
`[auth.smart] demographic_clients`). Storing the details as such a
`PERSON` is a sub-issue of #147 (maintainer, 2026-11-20).

eduLIMS finds the EHR with `GET /ehr?subject_id=…&subject_namespace=…` and,
on `404`, creates it with `POST /ehr` and that `EHR_STATUS` (ITS-REST 1.1.0,
EHR API, "Get EHR by subject id" and "Create EHR"). When two calls race,
FerroEHR answers the second `409`, and eduLIMS reads the EHR by its subject
again, so a patient has one EHR whatever the order. FerroEHR gives the EHR
its id, and `patients.ehr_id` stores it, unique across patients. A null
`ehr_id` means the EHR is pending: FerroEHR did not answer at the
registration. The registration still commits, the team's confirmation says
the record is not created yet, and the server logs `ferroehr_ehr_pending`
with the patient's id and the error's kind and status. The registration
waits at most 5 seconds for FerroEHR in all (token, lookup and create); past
that, the EHR is pending too. An unexpected error in this step, after the
commit, is logged as `ferroehr_ehr_failed` and also answers pending, so the
team never registers the patient twice. The next call that needs the EHR
tries again: the release of a result (#148) calls the same function, refuses
while the EHR is pending, and takes the EHR id as the branded type `EhrId`,
which only a resolved EHR yields. No job retries in the background.

The EHR is created once. A later correction of the patient's details in
eduLIMS does not rewrite the `EHR_STATUS`: the eduLIMS record is the source of
the patient's details, and FerroEHR holds the results (maintainer, #147).
FerroEHR writes the committer of every version itself, from the client that
signed in: `PARTY_IDENTIFIED` named by the client `edulims-ferroehr`, a
system client, never a person (FerroEHR book v5.7.0, `security/committer.md`).
eduLIMS sends no committer; FerroEHR refuses a stated committer with another
name. The maintainer accepted the client id as the committer on #364: it
carries no person, which is what Q-PRIV-1 protects. Finding and creating an EHR needs the scope
`system/composition-*.cr`, because an EHR operation names no template and
FerroEHR covers it only with the bare wildcard (`smart-app-launch.md`, "What
each route requires").

### Simulations and labs

A simulation and its labs live in eduLIMS's own tables
([ADR 0021](adr/0021-simulations-and-labs.md)); better-auth's organization
plugin is not used. There are no classes: a simulation belongs to no class,
and all students of a year take part in it. The service is
`src/server/simulations/`.

| Table | What it holds |
|---|---|
| `simulations` | the name, who created it and when, and its state: prepared, running or finished, with the server's time of the start and the finish (#267) |
| `simulation_teachers` | the teachers of a simulation, all with the same rights (D10) |
| `labs` | the labs of a simulation; a name is unique within its simulation, case-insensitively |
| `lab_members` | the students of a lab; the key (simulation, student) keeps a student in at most one lab of a simulation (S10) |
| `lab_member_emails` | the addresses a teacher pasted that wait for a student to sign in; the key (simulation, address) keeps an address in at most one lab of a simulation |
| `simulation_removals` | the students a teacher removed, so a lab's code does not let them back in |
| `correct_values` | the correct value per simulation, sample number and catalogue test, never per lab; one per sample number (regardless of case) and test; the value as `numeric`, never a float (D10) |
| `simulation_test_limits` | per simulation and test, the kind of limit (a percentage of the correct value or an absolute distance) and the yellow and red limits (D13) |
| `lab_tolerances` | a lab's own tolerance per catalogue test: a lower and an upper limit as `numeric`, the lower not above the upper; every change is a new row, never an update, and the newest row of a lab and test is the one in force (S13, #269) |
| `lab_join_codes`, `lab_join_attempts` | the join code of a lab, stored only as an HMAC with its key's fingerprint, and the wrong-code counters per student and per client IP, stored only as keyed hashes (#288) |

Every foreign key to a simulation or a lab cascades on delete, and a
student's place and a waiting address point at their lab through the pair
(lab, simulation), so neither can name a lab of another simulation.

- **Access in the query.** A teacher reaches a simulation through its
  `simulation_teachers` row, and a lab through the teacher row of its
  simulation. Every write locks the simulation row first. Another teacher's
  simulation, an unknown id and a malformed id all answer `not_found`, in a
  write, a page read and the target lab of a move alike, and every probe
  goes to the security log. A student reaches a lab only through
  their own `lab_members` row; that predicate is one exported helper
  (`studentLabsQuery`, `findStudentLab`) that the lab's work builds on.
  The lab's work goes through `findWorkingStudentLab`, which also requires
  a running simulation: a prepared or finished simulation takes no work.
- **State.** A teacher of the simulation starts a prepared simulation and
  finishes a running one, behind a confirmation; no step goes back. A start
  is refused while a test with a correct value has no limits, and the
  refusal names those tests; a running simulation is never deleted
  (maintainer, 2026-11-20 on #267). The correct values and the limits stay
  changeable in every state (D10).
  Starting locks the catalogue tests the simulation's correct values name
  `FOR SHARE`, so a catalogue edit that a running simulation forbids (D9)
  waits for the start and is then refused.
- **Correct values and limits.** The service is `src/server/correct-values/`;
  its one read and its writes go through the simulation's teacher row, and
  no function a student can reach imports it (Q-SIM-1). The limits live per
  simulation and test, not on the catalogue test: the catalogue is shared by
  every teacher, while a teacher sets the limits while preparing their own
  simulation, and a copy of a simulation takes its limits along (D15). Every
  change of a value or a limit leaves an activity-log row with the ids of the
  simulation, the test and the value, never the value itself (B4). While a
  simulation runs, a value for a test without limits is refused
  (`missing_limits`), and no function removes limits, so a running
  simulation never holds a test with a value and no limits (maintainer,
  2026-11-20).
- **Tolerances.** The service is `src/server/tolerances/`. A member of the
  lab sets a tolerance through `findWorkingStudentLab`, so only while the
  simulation runs, and the lab row is locked so its members write one at a
  time. A first tolerance for a retired test is refused. Every change is a
  new row with an activity-log row of ids only (`lab_tolerance_set`, never a
  limit), and no function removes one, so the release (S15, #270) can name
  the row in force. The student's page lists the active catalogue with the
  lab's own current tolerances; the teachers of the simulation see the
  tolerance in force per test and every change, newest first, 50 to a page.
  `findWorkingStudentLab` locks the student's `lab_members` row as well, so a
  write that waited behind a removal or a move of the student finds no place
  in the lab. A test with a tolerance counts as used in the catalogue (its
  unit is fixed), and a lab with a tolerance cannot be deleted
  (`has_records`; maintainer on #352). No write rate limit applies, since the
  draft names none. The one check, `checkTolerance` in
  `src/lib/tolerance.ts`, compares a value with the limits as decimals, and a
  value equal to a limit is inside (S13).
- **The email list.** A teacher pastes the addresses of a lab's members. The
  server classifies each line (invalid, repeated, already in this lab, in
  another lab of the simulation, new) and stores the new ones; no answer
  says whether an account exists for an address. An address waits until the
  student signs in, the teacher removes it, its simulation is deleted, or 90
  days have passed since it was added (owner, 2026-11-19); the daily
  retention prune deletes it then and logs only the count.
- **The link.** At every sign-in, and when the student opens the Student
  portal overview, each address that waits for the student's verified email
  becomes a place in its lab, one row per transaction. A failed row never
  fails the sign-in and never undoes another row; an address of a student
  who is already in another lab of that simulation is deleted, and the
  refusal is logged once. A teacher's removal wins over a waiting address:
  a student with a removal record in the simulation links nothing there,
  the refusal is logged with the reason `removed` once per removal (the
  link result counts it every time), and the address keeps
  waiting, because it may belong to a classmate whose own sign-in still
  links through it (#330). Only an account whose role set is {student} and
  whose address is plain ASCII links: lower-casing folds some other letters
  onto ASCII ones, so such an address is never verified either. The
  identity provider sync grants the student role to an address that waits
  on a lab's list, and only then: the student role only, at a first
  sign-in, through a provider whose addresses are authoritative, and never
  for a user SCIM provisioned (`createIdpRoleSync`).
- **The join code.** A teacher of the simulation turns a code on for one
  lab, replaces it or turns it off; the code is shown once and stored only
  as an HMAC under a key derived from `BETTER_AUTH_SECRET`, with that key's
  fingerprint, so a code made under a rotated secret shows as stale. It ends
  after the days and the joins the teacher chose (at most 30 days and 500
  joins). A student whose role set is exactly {student} joins that lab with
  it, and no other lab. Every attempt is charged to the student and to the
  client IP (only through `EDULIMS_TRUSTED_PROXIES`) before the lookup and
  refunded on a join; a wrong, expired, used-up or deleted lab's code and a
  removed student all get the same answer, with the real reason in the
  activity log. A student already in another lab of the simulation is
  refused as such, at no cost, and that refusal is logged once per student,
  lab and 15 minutes. A removed student cannot rejoin with a code or through
  a waiting address until a teacher adds their address again, which clears
  the removal of an account whose email is verified; an unverified email
  may be a classmate's, so adding it clears nothing (#330). A code join, a
  removal and a move delete the student's waiting address in the
  simulation in the same transaction, for a verified email only, wherever
  it waits except in a move's target lab (an address waits in at most one
  lab per simulation, so 0 or 1 rows). An unverified email drops nothing,
  because the row may be a classmate's; the link refusal keeps the removed
  student out. The removal and move log rows carry the number dropped
  (`count`, #330). A join locks the simulation row
  (shared) before the code row, and lets go and retries when the code row is
  taken, so it never deadlocks with a writer. The code panel is on the
  teacher's lab page; the Student portal overview lists the student's labs
  and holds the join form, and it runs the link as a POST once the page has
  loaded, never inside its read, which a preload also runs (#290).
- **Teachers.** A teacher adds another teacher by the address of an existing
  account with the teacher role; an unknown address and a non-teacher get
  the same refusal. The last teacher of a simulation cannot be removed: a
  teacher row counts only while its user holds the teacher role. eduLIMS
  deletes a user in one transaction (`src/server/users/delete-user.ts`,
  #318), the last step of the GDPR erasure path (#47), which has no screen
  yet: it locks the user's simulations in id order (and the administrators,
  when the user is one), refuses the only active teacher of a simulation and
  the last administrator, runs the deferred last-teacher check before it
  writes the activity-log rows, and deletes the sessions, the accounts and
  the user with those rows, so a refusal changes nothing. Better-auth's
  `admin/remove-user`, `delete-user` and `delete-user/callback` answer 404,
  and so do `admin/set-role`, `admin/update-user` and the core `update-user`
  (`src/server/users/admin-endpoint-lock.ts`, #345, #356): eduLIMS writes
  roles only through its own paths, and names come from the identity
  provider. Each call to one of them is a refused `authz_endpoint_closed`
  row. `admin/create-user` and `admin/ban-user` answer 404 over HTTP only,
  since the seed and the tests call `create-user` on the server. A
  `BEFORE DELETE` trigger on `user` and a deferred constraint trigger, which
  refuses any commit that leaves an existing simulation without a teacher
  row, stay as the last line. The other paths that take the admin role away
  or block an administrator, `pnpm admin:revoke` and the local role edit and
  the block of the Users screen, lock the administrators first, the same way
  and in the same order, before they read the target and count
  (`src/server/users/administrators.ts`, #345, #356). A blocked administrator
  does not count, so two of them, or one and a deletion, never leave eduLIMS
  without an administrator who can sign in; a deprovisioned administrator
  does not count either (maintainer, second review of #356). Under the same
  locks each of them checks that the acting administrator still holds the
  role and is neither blocked nor deprovisioned, and refuses with 403 when
  not. The global lock order is simulations, administrators, other users:
  `removeTeacher` takes the administrator locks after the simulation lock
  and before the teachers' rows. The session read ends a session of a
  blocked user, so a sign-in that raced a block keeps none. The local role edit
  and `admin revoke` end the sessions of a user who loses a role, each with
  a `session_revoked` row, so their next request signs in with the new set.
  The rule binds eduLIMS's own paths only: an identity provider stays
  authoritative over the roles it owns, by a claim or over SCIM, and may
  take the admin role from the last administrator (maintainer, #345); the
  host command `admin grant` is the way back. A SCIM role change keeps the
  user's sessions: eduLIMS reads the roles on every request, so the next one
  carries the new set. An administrator cannot give their own account
  teacher access without the identity provider, but one who mints a SCIM
  token holds the same trust as configuring that provider and can change the
  roles it owns through SCIM; the maintainer accepts this (#356 review, S4).
- **Deleting.** A lab can be deleted with its waiting addresses and its
  code once no student is in it and it holds no patient or request
  (`has_records`, maintainer, 2026-11-20), and a simulation only while no student is in
  one of its labs and none of its labs holds a patient, a request, a
  tolerance or a measurement (`has_records`, maintainer on #370); the
  teacher moves or removes the students first.
- **The administrator** reads each simulation with its teachers' names and
  its labs with their member counts, and nothing else (B5). The list in
  Admin → Simulations is paged and searched by name on the server, newest
  first with the id as the tie-breaker; the page size comes from a fixed
  allow-list and the search takes LIKE wildcards literally. A simulation
  whose teachers all lost the app role teacher (the same rule as the
  last-teacher guard) carries a "No active teacher" marker in the list and on
  its detail page, so an administrator can restore a role at the identity
  provider or in Users and roles (#291). The overview has one tile with the
  number of simulations.
- **The activity log** records every write with ids and codes only:
  `simulation_*` and `lab_*` actions, a count for a pasted list, never an
  address or a name.

#### The lab logo

The lab logo is an upload, held to the upload rules of the security baseline
(ASVS V5, the File_Upload cheat sheet; maintainer on #280 and #292):

- **What is accepted:** PNG and JPEG (baseline, extended 8-bit or
  progressive Huffman), at most 512 KiB and 1024 by 1024 pixels. The type
  comes from the first bytes and the image header; the file name and the
  declared type are never read. SVG, GIF, WebP, a lossless, hierarchical,
  arithmetic or 12-bit JPEG, and every other file are refused with a typed
  code (`logo_unsupported_type`, `logo_too_large`, `logo_too_many_pixels`,
  `logo_malformed`).
- **How it is made safe:** a small filter in `src/server/logo/` reads the
  PNG chunks (every CRC checked) or the JPEG marker segments and writes the
  file again with only what a browser needs to render it: for a PNG the
  critical chunks (a palette only for a palette image, with at most
  2^bit-depth entries), transparency and the fixed-size colour chunks; for a
  JPEG the frame, the quantisation and Huffman tables and the restart
  interval (each must consume its segment exactly), the scans and the fixed
  Adobe segment. EXIF, XMP, IPTC, ICC profiles, text and time chunks,
  comments and a truecolour image's suggested palette are dropped, and so is
  anything after the end of the image. The pixels are copied, never decoded
  or re-encoded. A photo loses its EXIF orientation and its colour profile
  with the rest.
- **Where it lives:** `lab_logos` in the eduLIMS database, one row per lab
  with the bytes, the type, the size, the dimensions and the SHA-256 (a CHECK
  holds it equal to `sha256(content)`), and no file name. It goes with its
  lab, and the database backup covers it.
- **Who changes it:** a teacher of the lab's simulation, through
  `uploadLabLogoFn` and `removeLabLogoFn`, under the lock of the simulation
  row. Every change and every refused file writes `lab_logo_changed` with
  ids and codes only. A form to any server function is refused before its
  body is read when it declares no length or more than 528 KiB, and the
  refusal closes the connection so Node does not read the rest
  (`src/server/form-body-limit.ts`). A logo can be changed in a finished
  simulation, the same as a lab's name: it carries no result (maintainer on
  #346).
- **Who reads it:** `GET /api/labs/$labId/logo` answers a member of the lab
  and a teacher of its simulation, in the same query that reads the logo,
  with the stored type, `nosniff`, `Content-Disposition: inline` with a name
  the server makes from the stored type, a sandboxing CSP,
  `Cross-Origin-Resource-Policy: same-origin` and `Cache-Control: no-store`
  like every other response (#41). Everyone else, an administrator and a
  signed-out caller included, gets the same empty 404 as a lab without a
  logo.
- **Where it shows (#293):** on the teacher's lab page, with the form that
  uploads, replaces and removes it; beside the lab's name on the teacher's
  simulation page; and on the student's overview of their labs. The reads
  of those pages carry a `logoVersion` (the start of the logo's SHA-256, or
  `null`), and the screens ask for `…/logo?v=<version>`, so a replaced logo
  is a new address and a lab without a logo asks for no image. Beside the
  lab's name the image is decorative (empty alt); on the lab page its alt is
  "Logo of {name}" (a lab's name often starts with "Lab"). The browser
  checks the declared type and the size before it sends a file
  (`src/components/simulations/logo-form-schema.ts`; a file the browser
  gives no type passes to the server); the server ignores both, its content
  check stays the authority, and each refusal code shows at the file field.
  The preview of a chosen file is a `data:` address, which is why the CSP
  allows `img-src data:`. The administrator's view
  (B5) reads no logo and renders no logo address.

### Patients, requests and samples

A team's records from the paper request form live in the eduLIMS database
(S11, S12, S16, #268). The service is `src/server/lab-records/`.

| Table | What it holds |
|---|---|
| `patients` | a patient as the team typed it: name, date of birth, sex and the patient ID of the form; who registered it and when |
| `requests` | a request for a patient of the same lab, or for a control sample with no patient (S16); the requester, the phone-through flag and the remarks; the time of entry |
| `request_tests` | the catalogue tests a request names, by foreign key to `catalogue_tests`; the release: the released measurement, the tolerance in force at the release, who released it and the time of release (#270) |
| `samples` | the samples of a request: the sample number and the material of the form, and the lab number |
| `record_corrections` | every correction of a patient or a request: the fields with their value before and after, who corrected and when |

- **Ownership in the schema.** Each row points at its lab through the pair
  (lab, simulation), and a request and a sample point at their patient and
  request through the pair (id, lab), so no row can name another lab's
  patient or request. Every key cascades with its lab.
- **Access.** Every write starts with `findWorkingStudentLab` in its own
  transaction, so the simulation row and the student's place stay locked
  `FOR SHARE` until the write commits: a finish cannot overtake it, and a
  removal or move that commits first leaves the waiting write no row. A member of a lab in a simulation
  that does not run gets `not_running`; anyone else gets `not_found`, and the
  probe goes to the security log. Every read joins the student's own
  `lab_members` row. Only a teacher of the simulation reads the correction
  log.
- **The time of entry** is the database clock of the transaction that stores
  the request: a trigger sets it on insert, whatever the insert carries, and
  refuses any change to it (G-01, Q-SIM-2).
- **What a form check refuses:** a missing required field, a date that is no
  date, a text past its bound, a control or format character (the remarks
  keep tab and line breaks), and a date of birth after today in
  Europe/Amsterdam by the database clock (maintainer, 2026-11-20). Nothing
  is checked against the scenario, and a second patient with the same
  patient ID in a lab is allowed.
- **The lab number** is ten digits: nine from `crypto.randomInt`, the first
  never zero, and a Damm check digit. A database function checks the digit
  in a CHECK, and a unique constraint holds it across every simulation; a
  drawn number that is taken is drawn again (`on conflict do nothing`), and
  five collisions in a row fail loud. A trigger refuses any change to a
  sample's lab number. A sample number has no unique key: a lab may record
  the same one twice (a second tube).
- **Corrections** are allowed until a requested test of the request, or of
  one of the patient's requests, has a time of release. A correction locks
  the request or patient `FOR UPDATE` (a patient correction also reads the
  patient's requests `FOR SHARE`), and the release locks the request
  `FOR UPDATE` too, so the two serialise. A correction never removes a
  sample or a requested test (`test_removed`, maintainer on #268) and never
  changes the patient or the kind of a request; a new
  sample gets a fresh lab number. Each correction writes a
  `record_corrections` row and an activity-log row with ids only.
- **The catalogue.** A request reads its tests `FOR SHARE` in id order, so a
  catalogue edit, which holds the test `FOR UPDATE`, serialises with it, and
  a test a request names counts as used (running while its simulation runs).
- **Screens.** The Student portal's Patients and requests page shows one of
  the student's labs at a time (`?lab=`, the newest by default), its
  patients and its requests with every sample's lab number in groups of
  three, three and four digits. The copy action copies the digits and says
  so in a status region (WCAG 4.1.3). Writing is open only while the
  simulation runs. The date of birth is the browser's native date input,
  shown in the reader's locale and sent as `YYYY-MM-DD`. The correction log
  is a section of the teacher's simulation page; it names a patient by its
  fictional name and a request by its samples' lab numbers.
- **FerroEHR.** After the registering transaction commits, eduLIMS finds or
  creates the patient's EHR and stores its id in `patients.ehr_id`
  ([The EHR of a patient](#the-ehr-of-a-patient)). When FerroEHR does not
  answer, the patient stays registered with its EHR pending, and the team
  reads that in the confirmation.

### Measurements and the release of a result

A team's measurements and the release of one of them as the result live in
the eduLIMS database (S14, S15, #270). The service is `src/server/results/`.

| Table | What it holds |
|---|---|
| `measurements` | every measurement of a requested test: its sample, the value as `numeric` within the bounds of a correct value, where it came from (`manual`, `afinion`, `epoch_upload`), who entered it (none for an analyser) and the database clock at the insert |
| `request_tests` | the release, on the requested test itself: one row per requested test, so at most one released measurement |
| `result_ehr_writes` | per released measurement of a patient request, the write of its Final composition to FerroEHR: `pending` or `written`, the contribution `uid` that keys the write, the version id FerroEHR gave it, the attempts, the last error as a code and the time of the next attempt (#148) |

- **Kept as they arrived.** A trigger refuses any change to a measurement and
  any direct delete; only its lab's cascade removes one. A correction never
  removes a requested test (`test_removed`, maintainer on #268), and the
  foreign key from a measurement to its requested test holds the same rule
  in the database.
- **The release.** A member of the lab picks a measurement and confirms. In
  one transaction the service checks the lab (`findWorkingStudentLab`),
  takes the lab row `FOR SHARE` (a tolerance change takes it `FOR NO KEY
  UPDATE`) and the request `FOR UPDATE` (as a correction does), then reads
  the tolerance in force. A test without a tolerance is `no_tolerance`, and a
  tolerance that changed since the team saw the warning is
  `tolerance_changed`, so the warning the team confirmed is the one against
  the tolerance stored with the release. The value is checked with
  `checkMeasuredValue` (`src/lib/tolerance.ts`), which parses and bounds it
  first and never throws. eduLIMS warns and never blocks (S15).
- **Final.** The trigger `request_tests_release` sets the time of release
  from the transaction's clock whatever the update carries, refuses a
  tolerance of another lab or test, and refuses any change or direct delete
  once a requested test is released, so a second release fails in the
  database too. No function updates a measurement or a release.
- **Who releases.** Every read and write matches the request, the test, the
  sample and the measurement to the lab in the same query. An analyser
  result is matched by the lab number alone (maintainer on #270), lands on
  that sample, and only the lab whose sample it is can release it.
- **The seam for the analysers.** The Afinion 2 route (#158) and the Epoch 2
  upload (#152) call `insertMeasurement` once they have matched the sample by
  its lab number. In the caller's transaction it checks that the lab's
  simulation runs (its row `FOR SHARE`), locks the request `FOR SHARE`,
  checks that the measurement comes from the test's own source (entry by
  hand only for a test entered by hand, D9), refuses entry by hand once the
  test is released, checks the sample, and parses and bounds the value
  (`value_invalid`). An analyser result that arrives after the release still
  lands and shows, and the release stays final (maintainer on #370). Every
  refusal writes an activity-log row; an analyser's measurement has no
  student (a CHECK), and its time is the database clock (a trigger).
- **FerroEHR (#148).** Before the release, `ensureReleaseEhr` finds or
  creates the patient's EHR (`ensurePatientEhr`, at most 5 seconds); while it
  stays pending, the release is refused `ehr_pending` with an activity-log
  row, and the release transaction refuses a patient without an EHR id too.
  The release commits a `pending` row in `result_ehr_writes` with it. After
  the commit, `writeReleasedResult` builds the Final composition
  (`src/server/openehr/lab-result.ts`) and commits it to the EHR in a
  CONTRIBUTION (`lab-result-writer.ts`), waiting at most 5 seconds; the team
  is told `written` or `pending`, and the release itself stands either way. A
  control request writes nothing (S16).
- **Idempotent on the measurement.** ITS-REST 1.1.0 gives a composition
  create no idempotency, but a CONTRIBUTION may carry its own `uid`, which
  the server refuses with `409` when it is in use (`contribution_create.yaml`).
  eduLIMS derives that `uid` from the measurement (UUIDv5, RFC 9562 §5.5), so
  every attempt sends the same one. On a `409` eduLIMS reads that contribution
  in the patient's EHR and takes its version id; a `409` without it is an
  error. A retry after a lost answer therefore finds the one composition and
  never writes a second.
- **Pending, retried, never skipped.** A failed write (FerroEHR unreachable,
  a refusal, a result it cannot build yet) stays `pending` with its error
  code and pauses 2^n minutes after the n-th failure, at most an hour. The
  app container retries due rows every minute
  (`src/server/plugins/result-ehr-writes.ts`), leasing each row for 5
  minutes, so replicas do not write one row at once; a write that lands late
  still marks its row. Each failure logs `ferroehr_result_pending` with the
  measurement id and the code, never a value. A written row never changes
  again (a trigger), as the released result never does.
- **The device.** FerroEHR accepts eduLIMS's compositions only as a device
  act whose composer names the device. A result entered by hand names the
  fixed device `eduLIMS manual entry` (identifier `manual`), with no person
  (maintainer, 2026-11-20 on #148). An analyser's result names the analyser
  by its serial number, which a measurement does not record yet: until #158
  and #152 record it (`ResultWriteDeps.resolveDevice` is the seam), such a
  result stays pending with `build:no_device_identifier`. The committer is
  the client `edulims-ferroehr`, by name only; the composition names the
  facility of `FERROEHR_FACILITY_ISSUER` and `FERROEHR_FACILITY_ID` and the
  territory of `FERROEHR_TERRITORY`.
- **On screen.** The team's results page and the teacher's view show per
  released result whether it is in the patient's record or still pending,
  with an icon and text; the release itself says so in its message, and a
  refusal `ehr_pending` keeps the confirmation open with its reason.
- **Who reads.** The team reads every measurement of its own lab with its own
  tolerance; the teachers of the simulation read the same with the released
  measurement marked and the tolerance kept at the release (D11). Neither
  read holds a correct value, a limit or an accuracy status (Q-SIM-1).
- **Screens.** The Student portal's Measurements and results page shows one
  of the student's labs at a time (`?lab=`, the newest by default): per
  request every requested test with its state as a badge with an icon and
  text, the team's own tolerance, and its measurements in a named,
  keyboard-reachable scroll region. Entry by hand opens a form whose refusal
  shows at its field. The release opens a confirmation (WCAG 3.3.4) with the
  value, the sample, the tolerance and, for a value outside it, a warning
  with an icon and text; the button then reads "Release anyway". Focus goes
  back to the button that opened a dialog, and after a release, whose button
  goes, to the heading of the requested test. A refusal that leaves nothing
  to confirm (the tolerance changed, the test is released, the simulation
  stopped) closes the dialog and shows at the requested test. The team and
  the teachers see the time of release. The teacher's lab page shows the
  same read-only, with the released measurement marked by an icon and text.
  The correction form of a request keeps every requested test ticked and
  fixed, so a correction never removes one (#268).

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
| `openEHR-EHR-COMPOSITION.report-result.v1` | 1.1.0 | the root | the result report as a whole |
| `openEHR-EHR-OBSERVATION.laboratory_test_result.v1` | 1.2.8 | `content`, one or more | the test, and the order in its protocol |
| `openEHR-EHR-CLUSTER.specimen.v1` | 1.1.3 | the observation's "Specimen detail" slot, one or more | the sample: sample number and well position |
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
| Lab number (S12) | `specimen.v1` | Laboratory specimen identifier (`at0001`), "normally assigned by the laboratory" | `DV_IDENTIFIER` | required, one |
| Sample number from the form | `specimen.v1` | External identifier (`at0088`), "assigned by a party external to the laboratory" | `DV_IDENTIFIER` | optional |
| Material | `specimen.v1` | Specimen type (`at0029`) | `DV_TEXT` | optional |
| Well position (Epoch 2) | `specimen.v1` | Specimen label (`at0098`) | `DV_TEXT` | optional; not written yet, a measurement does not record its well |
| Request | `laboratory_test_result.v1` | Test request details (`at0094`), Requester order identifier (`at0062`): the request's eduLIMS UUID (maintainer, 2026-11-20 on #148) | `DV_IDENTIFIER` | optional |
| Requester as typed from the form | none | the request id in `at0062` names the request | | stays in eduLIMS, not written to FerroEHR (maintainer, 2026-11-20 on #148) |
| Test name | `laboratory_test_result.v1` | Test name (`at0005`) | `DV_TEXT` | required, as in the archetype |
| Analyte name; for the Epoch 2 it includes the wavelength | `laboratory_test_analyte.v1` | Analyte name (`at0024`) | `DV_TEXT` | required, one |
| Value and unit | `laboratory_test_analyte.v1` | Analyte result (`at0001`) | `DV_QUANTITY` (`magnitude`, `units`; `magnitude_status` for a value outside the measuring range) | required, one |
| Result status | `laboratory_test_analyte.v1` | Result status (`at0005`) | `DV_CODED_TEXT`, local `at0017` Preliminary or `at0018` Final | required, one; a released result is Final |
| Time of release | `laboratory_test_analyte.v1` | Result status time (`at0006`) | `DV_DATE_TIME` | optional |
| Time of the measurement | `laboratory_test_analyte.v1` | Analysis performed time (`at0031`), and the observation's event time | `DV_DATE_TIME` | optional |
| Analyser | `device.v1` | Device name (`at0001`), Serial number (`at0020`), Other identifier (`at0024`) | `DV_TEXT`, `DV_TEXT`, `DV_IDENTIFIER` | Device name required, as in the archetype |
| Lab (facility) | the reference model | `COMPOSITION.context.health_care_facility` | `PARTY_IDENTIFIED` with the identifier of the system client's facility | FerroEHR refuses a composition without it |
| Composer | the reference model | `COMPOSITION.composer` | `PARTY_IDENTIFIED` naming the analyser, its serial number as identifier under the issuer `https://edulims.eu/id/analyser`; for a result entered by hand the fixed device `eduLIMS manual entry` with the identifier `manual` under the same issuer, and no person (maintainer, 2026-11-20 on #148) | FerroEHR checks it for the `device` origin |

The result status has two values, Preliminary and Final. FerroEHR holds only
the released result, written once as Final; every measurement and every
earlier value stays in the eduLIMS database, where the teacher sees them
(maintainer, 2026-11-20 on #148). The Afinion 2 analytes, HbA1c and CRP, are fixed by the
device; per test the teacher sets whether its measurements come from the Afinion 2, the Epoch 2 upload or entry by hand (D9). The Epoch 2
assays stay generic, an analyte name and a value per well and wavelength,
and the concentration is entered by the team or calculated by eduLIMS, as
the teacher chose for the test (D9, S4). Every result is a number with a
unit (`DV_QUANTITY`); a result that is not a number stays outside eduLIMS
(W8). No element carries the name, the student number or the
email address of a student or a teacher (Q-PRIV-1). The EHR subject is the
fictional patient the team registers (S11, O9).

Every composition eduLIMS writes passes openEHR validation against this
template (Q-COMP-1).

### Reporting

The teacher dashboard (D11, D13) is built inside eduLIMS, because the
databases run on the institution's own server and the correct values never
leave eduLIMS. It shows the progress and the process of a simulation and holds no
grade (W6). Turnaround time (G-01) is calculated with SQL on the eduLIMS
database; accuracy (G-03) compares a released result with the correct value,
which only eduLIMS holds, by the limits the teacher sets per test (D13). The
teacher also sees every measurement of a requested test, with the released
one marked as the one that counts (D11). A limit is a percentage of the
correct value or an absolute distance, and a value exactly on a limit gets
the better colour (D13).
A time target for urgent requests (D12, G-02, O1) and the ranking (D14,
G-04, O3) are not built in this iteration.
Details are in [teacher-dashboard.md](teacher-dashboard.md).

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
or the failed step changes. The scheduled check logs that row as eduLIMS (the
system); **Check now** logs it as the administrator who pressed it. A PostgreSQL advisory lock and the age of the last
result make one replica check per interval. The Admin portal reads the stored
result and refetches it every 30 seconds, so an unreachable service shows
within the 5 minutes of B3.

### Request size limits

TanStack Start reads the body of a server function call whole before the
function's own middleware runs: `request.formData()` for a form,
`request.json()` for everything else. So request middleware in `src/start.ts`
checks the size first, after the CSRF check, and the server never buffers more
than the limit for a caller who is not signed in (ASVS 5.0 V5.2.1, V15.2.2).

| Request | Limit | Refusal |
|---|---|---|
| JSON body to a server function | 1 MiB, declared and as it streams | 411 without a `Content-Length`, 413 over the limit |
| Form body to a server function (multipart or URL-encoded) | the largest lab logo (512 KiB) plus 16 KiB for its fields, declared (#292) | 411 without a `Content-Length`, 413 over the limit |
| GET payload of a server function (the `payload` query parameter) | Node's 16 KiB limit on the request line and headers | 431 from Node's HTTP parser, before eduLIMS runs |
| Body to a better-auth endpoint under `/api/auth/*` (sign-in, sign-out) | 64 KiB, declared and as it streams (#350) | 411 for a malformed `Content-Length`, 413 over the limit |
| SAML form post (`/api/auth/sso/saml2/*`: the ACS and single logout) | 128 KiB, declared and as it streams (#350) | as above |
| SCIM request (`/api/auth/scim/v2/*`) | 1 MiB, declared in the middleware, as it streams in the SCIM gate after its token check and rate limit (#45, #350) | as above, as a SCIM error (RFC 7644 §3.12) |
| Body to any other server route or page (`/api/health`, `/api/ready`, the lab logo, every page) | none: 0 bytes, a chunked body refused at once (#350) | as above |
| A chunked GET or HEAD, to any route | refused at once (#350) | 413 |

**The JSON limit** comes from the largest input any server function takes:
the pasted list of a lab's member addresses, 500 lines of 320 characters
(D10). Serialized as the Start client sends it, that list is 167,699 bytes in
ASCII, 487,699 bytes in 3-byte characters, and 807,699 bytes when every
character is `<`, which the serializer escapes. 1 MiB holds it for any
printable text. Only a list made mostly of control characters or U+2028,
which JSON writes as 6 or 7 bytes each, passes it, and no address list or IdP
metadata is made of those. The next largest input, a SAML provider with 100 KiB
of metadata, stays under 0.7 MB in every case.

The JSON check (`src/server/json-body-limit.ts`, #347) refuses a declared
length over the limit without reading a byte. Under it, the check reads a
clone of the body, counts the bytes, keeps none, and cuts the stream off as
soon as it passes the limit. Start then reads the other branch of the clone.
On Node, the HTTP parser already reads no more than the declared length as the
body, so the count is the guard for a body that lies about its length on
another path.

**The form limit** (#292) checks only the declared length: a form without a
`Content-Length` or above the limit is refused before Start reads it.

The JSON and the form refusals are empty responses with `Connection: close`, so Node closes
the socket instead of reading and discarding the refused body to keep the
connection alive. A refusal writes an `input_validation_fail` line to the
security log, one per client and reason in a minute (below); [deployment.md](deployment.md#keeping-the-log-on-the-host-bounded)
says how to keep a flood of them from filling the host.

A GET payload never reaches Start above 16 KiB: Node answers 431 first. An
e2e test (`tests/e2e/json-body-limit.spec.ts`) sends a 20 KiB payload, so a
raised header limit (`--max-http-header-size`) fails CI.

**The server route limits** (`src/server/route-body-limit.ts`, #350) run in
the same request middleware for every request that is not a server function
call, before the route reads a byte. Each family's limit comes from the
largest body it legitimately takes:

- **better-auth, 64 KiB:** the browser sends `/sign-in/sso`, `/sign-in/email`
  (development only) and `/sign-out`. Their largest fields are callback URLs,
  and a URL longer than Node's 16 KiB header limit could never be opened
  anyway, so three of them and the other fields stay under 64 KiB. The admin
  endpoints are called in-process by server functions, never over HTTP.
- **SAML, 128 KiB:** a signed response from the development Keycloak, with
  the role, e-mail and name attributes, posts as at most 10,161 bytes
  (measured for every development user). The limit leaves room for an
  encrypted assertion, which base64-encodes the XML a second time, and for an
  IdP that sends more attributes. The 128 KiB is our own margin over the
  measured 10 KB (maintainer decision on #350); no fixture holds a larger
  response. An operator whose IdP sends more raises it; today that is
  `SAML_BODY_MAX` in `src/server/route-body-limit.ts` and a new image, since
  no setting holds it.
- **SCIM, 1 MiB:** the cap of #45. The scim plugin offers no bulk endpoint
  (its ServiceProviderConfig says `bulk.supported: false`), and its largest
  body is a Group of its 1,000-member maximum: 418 KB with a `$ref` and a
  256-character `display` per member. A PATCH that adds 1,000 members is
  49 KB. The middleware checks only the declared length of a SCIM request;
  the SCIM gate counts the body, after the token check and the rate limit,
  so a caller without a token is limited before a byte of its body is read
  (maintainer decision on #350).
- **Every other route, 0 bytes:** the health and ready checks and the logo
  are GET routes, and no page takes a body. A chunked body to one of them is
  refused at once, unread.

The family comes from the raw path of the request URL, still
percent-encoded, which is the path the better-auth router and the SCIM gate
match. A prefix spelled with escapes (`/api/auth/s%73o/saml2/…`) falls to the
64 KiB family, so a body only ever meets the smaller limit. A GET or HEAD
with `Transfer-Encoding` is refused on every route.

A body without a `Content-Length` to the better-auth and SAML endpoints is
counted to the limit, not refused with 411 as a server function's is:
identity providers send these bodies, and their framing is not eduLIMS's to
choose. The count is the same one the JSON check uses (`fitsIn`), and the
SCIM gate's cap uses it too.
Over the limit the count cancels its clone and the body without waiting for
the source: the locale middleware (`src/server-entry.ts`) holds a clone that
nobody reads, and the source stops only when every clone is cancelled, so a
wait would hang the refusal. The socket closes after the 413 with the rest of
the body unread, so a client that keeps sending may see a TCP reset before it
reads the 413.
Every refusal sends `Connection: close` and writes an `input_validation_fail`
line with the family as `kind` and the proxy's `request_id`.

The JSON, form and route refusals share one log
(`src/server/body-refusal-log.ts`): one line per client and reason in a
minute, with `refused_count` for the refusals it stands for. The client is
the address behind `EDULIMS_TRUSTED_PROXIES`; without a trusted proxy every
client shares one window. The window is the `RefusalDeduper` the SCIM log
uses for refused tokens.

**No server-wide `maxRequestBodySize`.** srvx 1.0.8 and Nitro
3.0.261103-rc offer one, and srvx counts the streamed bytes, so it holds for a
chunked body. Nitro reads it only from the default export of a Nitro server
entry, though, not from the `nitro({...})` options, and a server entry adds a
catch-all route in front of Start's renderer. Its refusal is an error thrown
into whatever reads the body, which better-auth or Start turns into its own
answer, without `Connection: close`. The middleware covers every route that
reads a body, so it is the one limit.

## Deployment

Two places carry the system:

- **The lab.** Each Epoch 2 has its own PC with Gen5 3.11, connected over
  USB. The Afinion 2 is on the lab network over Ethernet, and the lab network
  routes to the server network. The sample number on the request form
  identifies the sample.
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
| Q-SEC-1, Q-SEC-2 | SSO only; access per role, filtered on the own lab and the own simulations | Entra ID or Keycloak through better-auth; role and ownership checks in server functions; no client-side access to FerroEHR |
| Q-SEC-3 | HTTPS; measurement data stays inside the institution's network | everything on one VM in an isolated network; TLS terminated in front of the app ([deployment.md](deployment.md)) |
| Q-PRIV-1 | no personal data of a real person in the CDR | data split between CDR and eduLIMS database; the EHR subject is a fictional patient, never a student or a teacher (O9) |
| Q-SIM-1 | a student gets no hint from eduLIMS | correct values and accuracy are read only by teacher functions in the eduLIMS database and never reach FerroEHR; negative tests with a student account |
| Q-SIM-2 | the server keeps the time | the times of entry and release are set by the server in the transaction that writes the row |
| Q-TRACE-1 | measurement traceable to device, sample, patient and team | the sample number from the form and the lab number of S12, which the team enters as the patient ID on the analyser (S5) |
| Q-PERF-1, Q-PERF-2 | pages within 2 s; upload within 10 s | server rendering; parsing and validation on the server, one REST write per composition |
| Q-REL-1 | 99% of the simulation hours; recovery within one working day | Compose stack restarts; one backup routine for both databases |
| Q-ACC-1 | WCAG 2.1 AA | shadcn/ui on Radix primitives; axe in Playwright tests |
| Q-MAINT-1 | core coverage at least 70%; docs current | Vitest coverage gate; this document in the Definition of Done |
| Q-SUST-1 | one environment, no idle services | one VM, one Compose file |
| Q-COMP-1 | HL7 v2, openEHR REST and AQL | FerroBRIDGE for HL7; template validation in FerroEHR |
