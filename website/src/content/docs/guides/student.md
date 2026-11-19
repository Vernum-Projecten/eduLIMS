---
title: Student guide
description: Sign in to the student portal, and what the portal will let you do.
sidebar:
  label: Student
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

The student portal (Studentportaal) is where your team runs its laboratory
during a game: you register patients and requests from the paper forms, link
the samples, measure, and release each result to the patient's record.

:::caution[Pre-release]
eduLIMS is in development. This guide describes what works today and lists
the planned tasks. A planned task links to its draft requirement, which can
still change.
:::

## Sign in

1. Open eduLIMS in your browser and choose **Sign in**.
2. Choose the sign-in button of your institution, for example the Microsoft
   or Keycloak button.
3. Sign in with your institution account.

eduLIMS opens the student portal. If your account has no role in eduLIMS
yet, the sign-in page tells you so.
Ask an administrator to give your account the student role.

You see only the work of your own team. The work of other teams is never
shown to you.

## Find your way around

The sidebar on the left lists the sections of the student portal; the current page
is highlighted. The button at the top left (or **Ctrl+B**, **Cmd+B** on a Mac)
folds the sidebar to icons and back, and eduLIMS remembers the choice; on a
phone it opens the sidebar as a panel. Above the page, the breadcrumb shows
where you are. Your name sits at the foot of the sidebar: choose it for your
account and role, the theme (light, dark or your system's setting) and
**Sign out**. Sections that are not built yet say **Coming soon**.

## If you have more than one role

A student account has only the student role. If you also teach, you get a
separate staff account for the Teacher portal.

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

## Join a class with a code

Your teacher usually invites your address, and you join the class the next
time you sign in. If you sign in with another address, your teacher can give
you a join code instead.

1. On your overview, find **Join a class**.
2. Type the code in **Join code**, such as `ABCDE-FGH23`. Capitals or small
   letters both work, and dashes and spaces are ignored.
3. Choose **Join class**. The class shows under **Your classes**.

If eduLIMS says the code does not work, check it with your teacher: it may
have ended, or the class may be full. After too many wrong codes, wait 15
minutes before you try again.

## Change the language

eduLIMS is in English and Dutch. Choose the language button in the header
(it shows the current language, such as **English**) and pick
**Nederlands** or **English**. The page reloads in that language. When you
are signed in, eduLIMS saves the choice to your account, so it also applies
the next time you sign in, on any device.

## Sign out

Choose your name at the foot of the sidebar, then **Sign out**. eduLIMS ends your session on the server.

## Planned tasks

| Task                                                                                                              | Requirement                       |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Work with your team in its shared patients, requests, samples and results                                         | [S10](/development/requirements/) |
| Register a patient from the paper request form                                                                    | [S11](/development/requirements/) |
| Record a request: its tests, routine or urgent, and each sample with the sample number and material from the form | [S12](/development/requirements/) |
| Set your team's own tolerances per test before you measure                                                        | [S13](/development/requirements/) |
| Upload a Gen5 Excel export of the plate reader by drag and drop                                                   | [S4](/development/requirements/)  |
| See the measurements per sample, from the Afinion 2 and the Epoch 2                                               | [S5](/development/requirements/)  |
| Measure a sample again; eduLIMS keeps every measurement                                                           | [S14](/development/requirements/) |
| Release a result to the patient's record; eduLIMS warns you when the value is outside your team's tolerance       | [S15](/development/requirements/) |

You and your team are the analysts. eduLIMS does not judge a result for you:
the warning against your team's own tolerance is the one check it gives.
