---
title: Student guide
description: Sign in to the student portal, and what the portal will let you do.
sidebar:
  label: Student
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

The student portal (Studentportaal) is where you follow a practical: register
your samples, check your measurements, and hand in your lab report.

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

You see only your own data. Results, submissions and grades of other students
are never shown to you.

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

## Change the language

eduLIMS is in English and Dutch. Choose the language button in the header
(it shows the current language, such as **English**) and pick
**Nederlands** or **English**. The page reloads in that language. When you
are signed in, eduLIMS saves the choice to your account, so it also applies
the next time you sign in, on any device.

## Sign out

Choose your name at the foot of the sidebar, then **Sign out**. eduLIMS ends your session on the server.

## Planned tasks

| Task                                                                                             | Requirement                      |
| ------------------------------------------------------------------------------------------------ | -------------------------------- |
| Read the assignment, the measurement protocol and the deadline of a practical                    | [S2](/development/requirements/) |
| Register samples; eduLIMS gives each sample a unique sample ID (monster-ID)                      | [S3](/development/requirements/) |
| Upload a Gen5 Excel export of the plate reader; eduLIMS checks every sample ID and well position | [S4](/development/requirements/) |
| Check the measurement results per sample, from the Afinion 2 and the Epoch 2                     | [S5](/development/requirements/) |
| Submit the lab report (labverslag) before the deadline; after you submit, it is locked           | [S6](/development/requirements/) |
| Read your feedback and grade, next to the average of the practical                               | [S7](/development/requirements/) |
| See the status of a submission: draft, submitted, graded                                         | [S8](/development/requirements/) |
| Submit a resit or a new version                                                                  | [S9](/development/requirements/) |
