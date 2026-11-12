---
title: Teacher guide
description: Sign in to the teacher portal, and what the portal will let you do.
sidebar:
  label: Teacher
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

The teacher portal (Docentportaal) is where you set up a practical, follow
the measurements of your students, and grade their lab reports.

:::caution[Pre-release]
eduLIMS is in development. This guide describes what works today and lists
the planned tasks. A planned task links to its draft requirement, which can
still change.
:::

## Sign in

1. Open eduLIMS in your browser and choose **Sign in**.
2. Choose the sign-in button of your institution and sign in with your
   institution account.

eduLIMS opens the teacher portal when your account has the teacher role. The
role comes from your identity provider; an administrator arranges it. If the
sign-in page says your account has no role, contact an administrator.

You see only the practicals you own or are linked to. Practicals of other
teachers, and the results in them, stay hidden.

## Find your way around

The sidebar on the left lists the sections of the teacher portal; the current page
is highlighted. The button at the top left (or **Ctrl+B**, **Cmd+B** on a Mac)
folds the sidebar to icons and back, and eduLIMS remembers the choice; on a
phone it opens the sidebar as a panel. Above the page, the breadcrumb shows
where you are. Your name sits at the foot of the sidebar: choose it for your
account and role, the theme (light, dark or your system's setting) and
**Sign out**. Sections that are not built yet say **Coming soon**.

## If you have more than one role

An account can be a teacher and an administrator at the same time. The top
of the sidebar then shows the portal you are in, such as **Teacher portal**.
Choose it to open the list of your portals and pick the other one, or press
**Alt+1** or **Alt+2** (**Option+1** or **Option+2** on a Mac). eduLIMS
remembers the portal you picked and opens it the next time you sign in. Each
portal shows only what that role may see: as an administrator you do not see
grades or results. The user menu at the foot of the sidebar lists all your
roles.

## Keyboard shortcuts

Press **?** anywhere outside a text field to see every keyboard shortcut,
with the keys for your computer; you can also open the list with
**Keyboard shortcuts** in the user menu at the foot of the sidebar. With
more than one portal, **Alt+1** and **Alt+2** (**Option+1** and **Option+2**
on a Mac) switch between them. On a page with a search field, **/** or
**Ctrl+K** (**⌘K** on a Mac) moves to it. Shortcuts never fire while you
type in a field or while a menu or dialog is open. If **?** and **/** get in
the way, for example with speech input, turn off **Single-key shortcuts** in
that list.

## Change the language

eduLIMS is in English and Dutch. Choose the language button in the header
(it shows the current language, such as **English**) and pick
**Nederlands** or **English**. The page reloads in that language. When you
are signed in, eduLIMS saves the choice to your account, so it also applies
the next time you sign in, on any device.

## Classes

**Classes** in the sidebar lists the classes you own or co-teach. Each class
shows its name with the academic year beside it, such as **LS-2A**
`2026–2027`, so two classes with the same name in different years stay
apart. **Archived** shows the classes of earlier years.

### Create a class

1. Choose **New class**.
2. Enter the class name and the academic year as two consecutive years, such
   as `2026-2027`.
3. Choose **Create class**. You become the class **owner**, and the class
   page opens.

The class page has three tabs: **Members**, **Invitations** and **Lab
groups**. Only the owner can edit, archive, reopen, copy or delete the class, invite
co-teachers and make a co-teacher the owner. A co-teacher invites and
removes students and manages the lab groups.

### Invite students and co-teachers

eduLIMS sends no email. You add addresses, and a person joins the class the
next time they sign in with that address.

1. Open the **Invitations** tab.
2. Choose **Student**, or **Co-teacher** if you own the class. A co-teacher
   must already have a teacher account in eduLIMS: an invitation never makes
   someone a teacher, so ask a colleague without an account to sign in once
   first.
3. Type or paste the addresses, one per line or separated by commas, or read
   them from a CSV file with one address per line.
4. Choose **Check list**. eduLIMS shows what happens to every address: it
   will be invited, or it is left out because it is not a valid address, is
   already in the class or is already invited. A co-teacher address without a
   teacher account in eduLIMS is left out too. A student invitation for an
   account that is not a student account is created, but that person never
   joins the class.
5. Choose **Invite** to create the invitations for the addresses that remain.
6. Choose **Copy invitation text** and share the text through your own
   channel, such as the course page. It has the sign-in link and the steps.

An invitation is valid for 30 days. **Pending invitations** lists the ones
that are not used yet; **Renew** gives an invitation, expired or not, another
30 days, and **Cancel** withdraws it. eduLIMS deletes old invitations 90
days after they were used, canceled or expired.

### Let students join with a code

A student who signs in with another address than the one you invited does
not join through the invitation. For them, turn on the class's join code on
the **Invitations** tab. It is off until you turn it on.

1. Under **Join code**, choose how many days the code works (7 unless you
   change it, at most 30) and how many students may join with it (100 unless
   you change it, at most 500).
2. Choose **Turn on join code**. eduLIMS shows the code, such as
   `ABCDE-FGH23`, once. Choose **Copy code** and share it with your students.
   eduLIMS keeps only a fingerprint of the code, so after you leave the page
   it cannot show the code again.
3. Students enter the code on their overview and join as students.

The panel shows until when the code works and how many students joined with
it. **New code** makes a new code with new settings; the old code stops
working at once. **Turn off** stops the code; the students who joined stay in
the class. A code never works while the class is archived, and too many wrong
codes in a row lock a student out for 15 minutes. A student you remove from
the class cannot rejoin with the code; invite their address again to let them
back in. If the panel says the code no longer works because the server's
secret changed, make a new code.

### Lab groups

Students often work in pairs or small groups. A class can have several
**group sets**, such as "Pairs" and "Groups of four", and a student is in at
most one group per set. Students never change groups themselves.

- **Create groups** makes empty groups in a set; then pick a group per
  student in **Students and their groups**. The picker works with the
  keyboard.
- **Split the class** puts every student into a new set, in groups of at most
  the size you choose, alphabetically or at random.
- **Copy a group set** takes the groups of a set from another class you
  teach, without the students.

### At the end of the year

- **Archive** makes a class read-only: no invitations, new members or group
  changes. It keeps its members and groups and moves to **Archived**. The
  owner can **Reopen** an archived class to change it again.
- **Copy to a new year** creates a class with the same name, the next
  academic year, the same co-teachers and the same group sets, without
  students. Invite the new students there.
- **Delete** is for a class created by mistake. It removes the class with its
  members, invitations and lab groups. A class with practicals, submissions or
  grades cannot be deleted; archive it instead.

## Sign out

Choose your name at the foot of the sidebar, then **Sign out**. eduLIMS ends your session on the server.

## Planned tasks

| Task                                                                              | Requirement                      |
| --------------------------------------------------------------------------------- | -------------------------------- |
| Create a practical with an assignment, a protocol, a deadline and a rubric        | [D1](/development/requirements/) |
| Link classes or individual students to a practical                                | [D2](/development/requirements/) |
| View the measurement results of all students of a practical                       | [D3](/development/requirements/) |
| Grade a submission per rubric criterion, with feedback and a final grade          | [D4](/development/requirements/) |
| Follow a class or a practical on the [KPI dashboard](/development/kpi-dashboard/) | [D5](/development/requirements/) |
| Export the grades as CSV                                                          | [D6](/development/requirements/) |
| See measured values that fall outside the expected range                          | [D7](/development/requirements/) |
| Reuse a rubric from an earlier practical                                          | [D8](/development/requirements/) |
