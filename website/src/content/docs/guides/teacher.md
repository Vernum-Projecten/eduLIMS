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
