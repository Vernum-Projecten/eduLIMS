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

## Sign out

Choose **Sign out** in the header. eduLIMS ends your session on the server.

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
