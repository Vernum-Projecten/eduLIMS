---
title: Administrator guide
description: Sign in to the admin portal, give users their role, and what the portal will let you do.
sidebar:
  label: Administrator
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

The admin portal (Beheerportaal) is where you manage the users of eduLIMS and
watch the integrations with the lab analysers.
This guide is for the functional administrator; installing and running the
server is in [Operations](/operations/install/).

:::caution[Pre-release]
eduLIMS is in development. This guide describes what works today and lists
the planned tasks. A planned task links to its draft requirement, which can
still change.
:::

## Sign in

1. Open eduLIMS in your browser and choose **Sign in**.
2. Choose the sign-in button of your institution and sign in with your
   institution account.

eduLIMS opens the admin portal when your account has the admin role.

## Change the language

eduLIMS is in English and Dutch. Choose the language button in the header
(it shows the current language, such as **English**) and pick
**Nederlands** or **English**. The page reloads in that language. When you
are signed in, eduLIMS saves the choice to your account, so it also applies
the next time you sign in, on any device.

## Give a user a role

eduLIMS knows three roles: `student`, `teacher` and `admin`. A user without a
role cannot use eduLIMS, and sees a message that asks them to contact an
administrator.

Today the role comes from the identity provider. At every sign-in, eduLIMS
reads the user's roles from the ID token and maps them to an eduLIMS role:

- **Microsoft Entra ID:** assign the app role `edulims-student`,
  `edulims-teacher` or `edulims-admin` of the eduLIMS app registration to the
  user or to a group the user is in.
- **Keycloak:** give the user the realm role `edulims-student`,
  `edulims-teacher` or `edulims-admin`.

The change applies at the user's next sign-in. The role names are
configurable ([Identity providers](/operations/identity-providers/)).

:::note
Whether roles are owned by the identity provider, by eduLIMS, or by the
provider with an override in the admin portal is an open question for the
product owner ([ADR 0010](/development/decisions/0010-vendor-neutral-oidc-entra-and-keycloak/)).
Role editing in the admin portal waits for that answer.
:::

## Planned tasks

| Task                                                                          | Requirement                      |
| ----------------------------------------------------------------------------- | -------------------------------- |
| Create users and assign a role                                                | [B1](/development/requirements/) |
| Create classes and link students to a class, by hand or by CSV import         | [B2](/development/requirements/) |
| Register the analysers and see whether FerroBRIDGE and FerroEHR are reachable | [B3](/development/requirements/) |
| Read the log of uploads, HL7 messages and errors                              | [B4](/development/requirements/) |
