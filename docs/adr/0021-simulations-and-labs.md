<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# 0021. A simulation is a better-auth organization, a lab a team

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
Requirement B2 is dropped, and D10 and S10 carry the new model.

Where do a simulation and its labs live in the data model, and what happens
to the class service that is already built and tested?

## Decision drivers

- A student sees the work of their own lab only, and a teacher only their
  own simulations (S10, D11, R-01). That check sits in every database query.
- A teacher prepares a simulation alone, without an administrator (D10).
- A student reaches their lab without a step of their own, and eduLIMS sends
  no email (S10).
- The membership checks, the join-code limits and their negative tests are
  built and tested. Work that still fits is kept.

## Considered options

- **Keep classes and attach a simulation to a class.** The class stays the
  organization, and a simulation becomes a new entity under it.
- **A new model beside the organization plugin.** eduLIMS's own tables for
  simulations, labs and members, and the class service removed.
- **Reuse the organization and the team.** The organization becomes the
  simulation and the team becomes the lab.

## Decision outcome

Chosen option: **reuse the organization and the team.** The owner's decision
rules out the first option, because a simulation belongs to no class. The
second option throws away tested access checks and writes them again for the
same shape: a unit with members, and groups of members inside it.

- **One simulation is one organization.** Its name is the simulation's name
  (for example "Simulation 2026"). The correct values of D10 are keyed to it.
- **A lab is a team** inside the simulation, with its lab name and its logo.
  A teacher creates the labs (D10); a team of students does not create or
  name its lab in eduLIMS.
- **Membership by email address.** The invited-email path of ADR 0018
  becomes "the teacher adds a member's email address to a lab". A teacher
  pastes the addresses as a list. A student who signs in with one of those
  addresses is linked to that lab at sign-in, and eduLIMS sends no email
  (S10).
- **The join code moves from the class to the lab** and is the fallback: a
  student who signs in with another address joins with the lab's code (S10).
- **The class service is reworked and kept.** `src/server/classes/` keeps
  its rule that every write runs behind a membership check on the
  session user, with the plugin's own endpoints unreachable. It gets the new
  terms and the new write paths.
- **Every student has their own account** (O10). Open: team roles with
  different rights (O10).
- **Not decided here:** copying a simulation to a next year (O11), and what
  becomes of the fields and rules ADR 0018 gave a class (the academic year,
  the archive, the co-teacher role, the administrator's class actions). The
  rework on #280 settles them with the owner.

### Consequences

- Good: the plugin's tables and ids stay, and so do the membership checks in
  the SQL of every read and write.
- Good: the join code keeps its mechanisms: the HMAC at rest, the count of
  attempts per student and per client IP, and the record of a removed
  student.
- Bad: the routes, the messages and the tests of the class screens are
  renamed, and the class tables and the documents that name them follow.
  Until the rework lands, the code and the user guides still say "class" and
  "lab group".
- Bad: a lab logo is a new upload. It has to follow the upload rules of
  `.claude/rules/auth-security.md` (ASVS V5): a defined set of types, a
  configured size limit and a check of the content.
- Bad: a join code per lab means more codes for a teacher to hand out than
  one code per class.
- Bad: an email address a teacher mistypes links nobody. The student then
  needs the lab's code.

## References

- [Requirements](../requirements.md): S10, D10, B2 (dropped), O10 and O11.
- [ADR 0018](0018-classes-as-organizations.md), which this record
  supersedes, and [ADR 0020](0020-workplace-simulation.md).
- better-auth organization plugin: <https://better-auth.com/docs/plugins/organization>
