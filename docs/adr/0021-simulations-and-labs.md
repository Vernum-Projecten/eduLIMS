<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# 0021. Simulations and labs in eduLIMS's own tables

- Status: Proposed
- Date: 2026-11-19
- Deciders: product owner, maintainer

## Context and problem statement

[ADR 0018](0018-classes-as-organizations.md) built classes on the better-auth
organization plugin: a class is an organization, a lab group is a team inside
it, a person joins a class through an invitation on their email address or
through the class's join code, and eduLIMS's own class service does every
write. [ADR 0020](0020-workplace-simulation.md) then replaced the practical
model with a workplace simulation and left the classes in place.

On 2026-11-19 the owner decided that there are no classes. All students of a
year do the simulation. The unit is a simulation with a name of its own, and
it holds the correct values and the labs. A lab is a team of students with a
lab name and a logo the team made up; a teacher creates the labs, and the
labs compete with each other. The teacher adds the email addresses of a lab's
members, and a student who signs in with one of them is linked to that lab.
Requirement B2 is dropped, and D10 and S10 carry the new model. The owner
also asked for a full rewrite with deletion preferred: nothing is in
production, so no compatibility layer and no class code kept for later.

Where do a simulation and its labs live in the data model, and what happens
to the class service that is already built and tested?

## Decision drivers

- A student sees the work of their own lab only, and a teacher only their
  own simulations (S10, D11, R-01). That check sits in every database query.
- A teacher prepares a simulation alone, without an administrator (D10).
- A student reaches their lab without a step of their own, and eduLIMS sends
  no email (S10).
- The join-code limits, the removal record and their tests are built. Work
  that still fits is kept; the rest is deleted.

## Considered options

- **Keep classes and attach a simulation to a class.** The class stays the
  organization, and a simulation becomes a new entity under it.
- **Reuse the organization and the team.** The organization becomes the
  simulation and the team becomes the lab.
- **Own tables, and the organization plugin removed.** eduLIMS's own tables
  for simulations, teachers, labs, members and waiting addresses.

## Decision outcome

Chosen option: **own tables, and the organization plugin removed.** The
owner's decision rules out the first option, because a simulation belongs to
no class. After the rework the plugin would give four table names and
nothing else: its HTTP paths are disabled, its write hooks all refuse, its
roles have no use, and its invitation table is read only by its own disabled
routes. Its tables have the wrong shape too: a plugin `member` row is not a
place in one lab, and nothing in them keeps a student in one lab of a
simulation. Before the plugin was removed, SCIM provisioning (ADR 0017, its
own `scim*` tables), the session, the admin plugin, the SSO plugin and the
browser client were checked: none of them depends on it.

- **Tables** (plural snake_case, `uuidv7()` keys, `timestamptz`):
  `simulations`, `simulation_teachers`, `labs`, `lab_members`,
  `lab_member_emails`, `simulation_removals`, and the lab's join code in
  `lab_join_codes` and `lab_join_attempts`. One lab per student per
  simulation and one waiting place per address per simulation are primary
  keys. A lab name is unique within its simulation, case-insensitively.
  Every foreign key to a simulation or a lab cascades on delete. The plugin's
  tables and its two session columns are gone.
- **Access in the query.** A teacher reaches a simulation through its teacher
  row; every write locks the simulation row first. Another teacher's
  simulation answers `not_found`, never `forbidden`, and a malformed id is
  refused before the query and logged. A student reaches a lab through their
  own place in it, with one exported predicate for the lab's work.
- **Membership by email address.** A teacher pastes the addresses of a lab's
  members. Each line is classified before anything is stored, and no answer
  reveals whether an account exists. An address does not expire: it waits
  until the student signs in, the teacher removes it, or the lab is deleted.
  It is linked at sign-in and when the student opens the Student portal
  overview, for a verified address only, one row per transaction, and a
  failed link never fails the sign-in (S10).
- **The join code moves from the class to the lab** and is the fallback for
  a student whose address is on no list (S10, #288). Its mechanism stays:
  the HMAC at rest with a key fingerprint, the term and use limits, the code
  shown once, the attempt counting per student and per client IP, and the
  identical answer for every wrong code.
- **Teachers of a simulation** all have the same rights (D10). A teacher
  adds another by the address of an existing account with the teacher role.
  The last teacher of a simulation cannot be removed, and an account that is
  the only teacher of a simulation cannot be deleted.
- **No roles inside a lab** (S10, O10). Every member of a lab may do
  everything in it, and eduLIMS records who did what.
- **Deleting.** A teacher can delete a lab, and a simulation that has no
  student.
- **The administrator** sees the simulations with their teachers, their labs
  and the number of members, read-only, and nothing of a lab's work and no
  correct value (B5, a Should).
- **Deleted** with their routes, messages, audit events and tests, because no
  requirement needs them: the academic year, archive and unarchive, the class
  copy, the owner and co-teacher distinction, ownership transfer, group sets
  and the automatic split, every administrator action on a class, the CSV
  import, invitations with a role, a status and an expiry, and the
  class-level join code.
- **Copying a simulation** to a new one, with its correct values and without
  its labs, is a Could (D15).

### Consequences

- Good: the tables say what the model is, and the database holds the two
  rules that matter most (one lab per student, one waiting place per
  address).
- Good: no third-party schema decides a column, and no disabled plugin
  endpoint is one configuration change away from reachable.
- Bad: the access checks of the class service are written again for the new
  shape, with their negative tests per role; about 60 deleted test cases each
  need a counterpart.
- Bad: a lab logo is a new upload (#292). It follows the upload rules of
  `.claude/rules/auth-security.md` (ASVS V5): PNG or JPEG checked by content,
  a size and pixel limit, metadata removed, stored in PostgreSQL.
- Bad: a join code per lab means more codes for a teacher to hand out than
  one code per class.
- Bad: an email address a teacher mistypes links nobody. The student then
  needs the lab's code.

## References

- [Requirements](../requirements.md): S10, D10, D15, B2 (dropped), B5, O10
  and O11.
- [ADR 0018](0018-classes-as-organizations.md), which this record
  supersedes, and [ADR 0020](0020-workplace-simulation.md).
- The design of the rewrite: the maintainer's comment on #280.
