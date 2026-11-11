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

## Find your way around

The sidebar on the left lists the sections of the admin portal; the current page
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

## Users and roles

**Users and roles** lists every account of eduLIMS, 25 to a page. Each row
shows the name and e-mail address, the roles with where they come from
(an identity provider or eduLIMS), the sign-in methods, the status
(**Active**, **Blocked** or **Never signed in**), the last sign-in and the
number of active sessions. The screen shows no grades, results or
submissions.

- **Search** by part of a name or an e-mail address: the list follows while
  you type.
- **Filter** with **Role**, **Sign-in method** and **Status**. Each opens a
  list of its values with the number of users for each; choose one or more
  values (a user matches any of them), and combine the filters. The chosen
  values show on the button. **Reset** clears the search and every filter.
  The search and the filters are part of the address, so you can bookmark or
  share a filtered view.
- **Sort** with the menu of the **Name** or **Last sign-in** header
  (**Ascending** or **Descending**). **Hide column** in a header menu, or
  **View**, hides and shows columns; this browser remembers the choice.
- **Rows per page** shows 10, 25, 50 or 100 users; the buttons beside it go
  to the first, previous, next and last page.
- **The row menu** (the button at the end of each row) opens the details,
  ends all sessions of the user, or blocks or unblocks them.
- **Select rows** with their checkboxes, or every row of the page with the
  checkbox in the header, to act on them at once: **End sessions** signs the
  selected users out everywhere, **Block** blocks them with one reason and
  an optional last day. Your own account cannot be selected.

Choose a name to open the user's details beside the list. The details have
their own address, so you can share a link to one user. They show:

- **Profile:** when the account was created, the last sign-in and its
  method, and the saved language and portal.
- **Roles:** the user's roles and where they come from (see below).
- **Block:** block or unblock the user.
- **Active sessions:** the browsers and devices the user is signed in on.
  **End session** signs the user out on one device, **End all sessions** on
  every device. On your own account you cannot end the session you are using
  (sign out instead); **End all other sessions** keeps it open.
- **Linked accounts:** the identity-provider accounts linked to the user.
- **Recent activity:** the last ten events of the activity log about or by
  this user.

Every action asks you to confirm it first, says in a message whether it
worked, and is recorded in the activity log.

### Block a user

Choose **Block user**, write the reason and, if the block should end by
itself, choose its last day. A blocked user is signed out at once, and every
sign-in is refused, through every identity provider too, until the
last day has passed or you choose **Unblock**. Only administrators see the
reason. You cannot block your own account.

## Give a user a role

eduLIMS knows three roles: `student`, `teacher` and `admin`. A user without a
role cannot use eduLIMS, and sees a message that asks them to contact an
administrator. A user holds one role, or both teacher and administrator; a
student cannot hold another role.

A user's roles come either from the identity provider or from eduLIMS:

- **From the identity provider.** When the identity provider sends an
  eduLIMS role, it decides: eduLIMS sets the user's roles from it at every
  sign-in, and the details show **From** and the provider's name, such as
  **From Keycloak**. Change these roles in the identity provider; the change
  applies at the user's next sign-in.
- **From eduLIMS.** When the identity provider sends no eduLIMS role, the
  roles an administrator assigned in eduLIMS apply, and the details show
  **From eduLIMS**. Change them in the details under **Change roles**: tick
  the roles and choose **Save roles**. The change applies at once.

Nobody can change their own roles; ask another administrator.

At every sign-in, eduLIMS reads the user's roles from the identity provider
(the ID token's role claim, or a SAML attribute) and maps them through the
provider's role map. With the usual role map:

- **Microsoft Entra ID:** assign the app role `edulims-student`,
  `edulims-teacher` or `edulims-admin` of the eduLIMS app registration to the
  user or to a group the user is in.
- **Keycloak:** give the user the realm role `edulims-student`,
  `edulims-teacher` or `edulims-admin`.

The change applies at the user's next sign-in.

## Identity providers

**System → Identity providers** lists the services people sign in with:
OpenID Connect providers (such as Microsoft Entra ID or Keycloak) and SAML 2.0
providers (such as a federation). Each has its own sign-in button, role map
and email domains.

- **Add OIDC provider** or **Add SAML provider** opens the form. A new
  provider starts switched off. The client secret and the signing key are
  stored encrypted and never shown again: leave the field empty to keep them,
  or fill it to replace them.
- The provider's page shows the URLs to register at the identity provider,
  with a copy button.
- **Test sign-in** signs in through the provider in a new tab and shows which
  claims arrive and which roles they would give. It signs nobody in, so you
  can test a provider before you enable it.
- **Enable** puts the button on the sign-in page; **Disable** takes it off
  and refuses every sign-in through it. You cannot switch off the last
  enabled provider here: the host operator can.
- **Delete provider** removes a provider nobody signed in with. A provider
  with accounts can only be disabled.
- **Role map:** each value the provider sends (an app role, a realm role, a
  group) and the eduLIMS role it gives. **Default role** is for a new user the
  provider sends no listed value for; leave it at none to refuse them.
- **This provider's email addresses are verified:** turn it on only for a
  provider that controls every address it sends, such as the institution's
  own tenant.
- **Email domains:** people who type an address in one of these domains on
  the sign-in page go to this provider.

Every change is recorded in the activity log, without any secret or value.
Setting up a provider on the identity provider's side is described in
[Identity providers](/operations/identity-providers/).

## Classes

Teachers create their own classes and invite their students and
co-teachers; see the teacher guide. **Classes** in the admin portal lists
every class in eduLIMS, newest academic year first, with its owner, its
co-teachers, the number of students, the number of pending invitations and
whether it is archived. It shows no grades or results. The list is
read-only.

A person who signs in with an address a class invited joins that class
without any further step. When the identity provider sends no eduLIMS role
for a person signing in for the first time, a pending invitation as a
student gives them the student role, and only that role, if the provider's
email addresses are marked as verified. It never gives back a role the
identity provider took away. You cannot delete a user who owns a class:
the owner transfers the class to a co-teacher first. Teacher and administrator roles always come from the identity
provider or from **Users and roles**.

Creating, inviting, accepting, removing, archiving, copying, transferring
ownership and every lab-group change are recorded in the activity log, with
ids only.

## Planned tasks

| Task                                                                          | Requirement                      |
| ----------------------------------------------------------------------------- | -------------------------------- |
| Create users and assign a role                                                | [B1](/development/requirements/) |
| Create classes and link students to a class, by hand or by CSV import         | [B2](/development/requirements/) |
| Register the analysers and see whether FerroBRIDGE and FerroEHR are reachable | [B3](/development/requirements/) |
| Read the log of uploads, HL7 messages and errors                              | [B4](/development/requirements/) |
