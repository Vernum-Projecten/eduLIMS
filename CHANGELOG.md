<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Changelog

Every notable change to eduLIMS is recorded here. The format follows
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html). New
entries arrive as fragments under `changelog.d/` and are assembled here at
each release (`docs/release.md`).

## [Unreleased]

## [0.1.0] - 2026-11-12

### Added

- `pnpm db:seed` gives the development login accounts classes of their own, so the Teacher and Student portals show data: Test Teacher owns LS-3A of this year (with Test Coordinator as co-teacher, Test Student among twelve students, three lab groups and two pending invitations) and last year's archived LS-3A, and Test Coordinator owns LS-3B with Test Teacher as co-teacher. An existing development database gets them on its next `pnpm db:seed` (#190).
- Classes in the teacher portal (B2, D3): a teacher creates a class with its
  academic year, invites students and co-teachers by typing, pasting or
  reading a CSV list after a preview, and shares a translated invitation
  text; eduLIMS sends no email. A person joins every class that invited their
  verified address when they sign in. Teachers manage lab groups in group
  sets (by hand, by splitting the class or by copying a set), archive a class
  at the end of the year, reopen it, and copy it to the next. The demo data
  holds classes with members, lab groups and pending invitations. Students see their classes
  and pending invitations on their overview, and administrators see every
  class without grades or results. Upgrade step: the `edulims-migrate`
  service applies the new `0012_classes` migration on the next
  `docker compose up`, and the retention prune also deletes class invitations 90
  days after they ended (#28).
- eduLIMS keeps an activity log (B4): every sign-in, failed or refused
  sign-in, sign-out, ended session, role change, block, unblock, created and
  deleted user is recorded with ids and codes only, never a name, an e-mail
  address or an IP address. Events older than 12
  months and sessions that expired more than 30 days ago are removed
  (`docs/deployment.md`, "Retention"). `pnpm db:seed` also fills a fictional
  demo set of 70 people with accounts, sessions, blocks and four weeks of
  activity. Upgrade step: the `edulims-migrate` service applies the new
  `0005_audit_event` migration on the next `docker compose up` (#33).
- The admin portal's **Users and roles** screen (B1): a server-side paged,
  sorted and filtered table of every account (search on name and e-mail
  address; filters on role, sign-in method and status, kept in the address),
  and a details panel per user with the profile, the roles and where they
  come from, linked accounts, active sessions with **End session** and
  **End all sessions**, block and unblock with a reason and an optional last
  day, and the user's recent activity. Roles are owned in a hybrid way: a
  role the identity provider sends decides at every sign-in; without one, the
  roles an administrator set in eduLIMS apply, and only those can be edited
  here. A blocked user is refused at every sign-in, SSO included. The login
  page says which method this browser signed in with last time. Upgrade
  step: the `edulims-migrate` service applies the new `0007_user_role_source`
  migration on the next `docker compose up` (#34).
- The admin portal's **Analysers and integrations** screen (B3): the status
  of FerroEHR and FerroBRIDGE, each with its state as an icon and text, the
  last check, the last success, the response time and the reason of a
  failure, checked every minute inside the app container and on demand with
  **Check now**, so an unreachable service shows as **Unavailable** within
  5 minutes, and one that refuses eduLIMS's credentials as
  **Refused (authentication)**; and the analyser register, a searchable, filtered and sorted
  list of every analyser with its model, serial number, location, route to
  FerroEHR and status, where administrators add, edit and retire analysers,
  each change recorded in the activity log. The check targets come only from
  `FERROEHR_BASE_URL` and `FERROBRIDGE_BASE_URL`. Upgrade step: the
  `edulims-migrate` service applies the new `0009_analyser` and
  `0010_integration_check` migrations on the next `docker compose up` (#35).
- The Admin portal has a full activity log at **Activity log**: every
  sign-in, refused sign-in, ended session, role change and block, newest
  first, 25 to a page. Filter it by the user who acted, the user it is
  about, the action, the outcome and a period of days; the filters, the sort
  and the page are part of the address, so a view can be shared. Names are
  looked up for the screen only; the log still holds ids and codes. A user's
  details link to their events. Upgrade step: the `edulims-migrate` service
  applies the new `0011_audit_event_indexes` migration on the next
  `docker compose up` (#36).
- The admin portal's overview shows the number of users per role, the active
  sessions and the blocked users (each linking to that filter of **Users and
  roles**), the state of FerroEHR and FerroBRIDGE, and the latest
  activity-log events. **System** now also shows, read-only, every enabled
  identity provider with its callback URL, role claim and role map, and the
  eduLIMS version, commit, build time and SLSA provenance reference of a
  release image; it never shows a secret. The release image sets these build
  values itself, so operators set nothing (#36).
- Administrators manage every class (B2): the class list in the admin portal
  searches and filters by status, academic year and owner, page by page, and
  opens a class page with its members and pending invitations, without
  grades or results. An administrator creates a class on a teacher's behalf,
  imports its students from a CSV list after a preview (as pending student
  invitations that apply at each student's own sign-in), transfers the
  ownership to any teacher, and archives or reopens a class, without
  becoming a member. A user who owned a class can be deleted once its
  ownership has moved (#37).
- eduLIMS writes every security event (sign-ins, role changes, blocks, refused calls) to its output as one JSON line with ids and codes only, and the optional `compose.logship.yaml` ships those events to the institution's log platform over TLS, as syslog or HTTPS; turn it on with `COMPOSE_FILE` and the `LOGSHIP_` values in `.env` (#44).
- Identity providers can provision and deprovision users over SCIM 2.0 (B1): administrators see provisioned users before their first sign-in, roles follow the provider's role map, and a user the directory deactivates loses every session at once and cannot sign in, while their records stay. Create, replace and revoke each provider's SCIM token on its page in Admin → System → Identity providers or with `scim token` from the tools image: a token works for 180 days, the page warns 14 days before it expires, and a replaced token keeps working for one hour; the database migration `0013_scim` runs with the usual migrate step. Set `EDULIMS_TRUSTED_PROXIES` to the reverse proxy's address so the SCIM rate limit can tell clients apart; left empty, no forwarded header is trusted (#45).
- An OpenID Connect provider is saved only when it offers PKCE with S256 or an administrator attests that it enforces it, disabling a provider ends its users' sessions, SAML single logout must be signed and SAML sign-ins need a persistent NameID, and sign-out ends the identity-provider session of the provider the session signed in with (#46).
- Identity-provider client secrets and SAML signing keys are stored encrypted (AES-256-GCM under `EDULIMS_DATA_KEY`), the SSO plugin's own provider-management endpoints are unreachable, and an issuer on a private network is refused unless the operator allows its origin (`EDULIMS_IDP_PRIVATE_ORIGINS`) (#46).
- Administrators manage the identity providers in Admin → System → Identity providers: OpenID Connect (Microsoft Entra ID, Keycloak) and SAML 2.0 providers, each with its own sign-in button, role map, default role and email domains, a test sign-in, and enable, disable and delete; signing out also ends the session at an OIDC provider that offers it (#46).
- `admin grant <email> --provider <id>` from the tools image gives the first or a break-glass administrator the admin role, also before that person ever signed in: the grant waits 24 hours for their first sign-in through that provider; `admin revoke` takes it away again, never from the last administrator (#48).
- A class owner or co-teacher can turn on a join code (shown once, valid for up to 30 days and 500 joins), and a student who signs in with another address than the invited one joins the class with it from their overview; wrong codes are limited per student and, behind the proxies in `EDULIMS_TRUSTED_PROXIES`, per client address, a removed student cannot rejoin with the code, and every join is in the activity log (B2, S2). Upgrade step: the `edulims-migrate` service applies the new `0014_class_join_code` migration (#49).
- Charts now have one accessible foundation built on TanStack Charts: every
  chart has a name and a description for screen readers, a **View as table**
  button that shows the same values as a table, a legend that tells series
  apart by shape as well as colour, colours that keep enough contrast in the
  light and the dark theme, and numbers in the language you chose. The
  unused `recharts` library is gone. A development-only example page at
  `/dev/charts` shows a scatter plot with fictional data; production
  deployments do not serve it (#59).
- Keyboard shortcuts: press **?** outside a text field, or choose
  **Keyboard shortcuts** in the user menu, for a list of every shortcut with
  the keys of your computer (⌥ and ⌘ on a Mac, Alt and Ctrl elsewhere). Pages
  with a search field can move to it with **/** or **Ctrl+K** (**⌘K** on a
  Mac). The portal shortcuts (**Alt+1**, **Alt+2**) work as before. No
  shortcut fires while you type in a field or while a menu or dialog is open,
  and **Single-key shortcuts** in the list turns **?** and **/** off
  (WCAG 2.1.4) (#63).
- Long lists can now be virtualised: only the rows in view are rendered, so a
  list of 10,000 rows scrolls smoothly and stays usable with the keyboard
  (arrow keys, Home, End, Page Up and Page Down) and a screen reader, which
  still hears each row's position in the whole list. Developers get the
  TanStack Devtools panel (Router, Query and Form) in `pnpm dev`; production
  builds contain none of it (#64).
- Data tables can render a long list that is not paginated with only the rows
  in view, so a table of 10,000 rows scrolls smoothly with a header that stays
  in place, works with the keyboard (arrow keys, Home, End, Page Up and Page
  Down) and tells a screen reader each row's position in the whole table.
  Paginated tables such as the users list are unchanged (Q-PERF-1) (#76).
- A new application shell: a sidebar per portal that folds to icons (a panel on
  phones) with a breadcrumb and a user menu, a "coming soon" page for each
  planned section, a two-column login page that lists the demo accounts while
  the development login is on, and a light, dark or system theme that is
  remembered per browser.
- eduLIMS has a logo: a corner of a 96-well microplate with one amber sample well. The
  application shows it in the header and as its browser and home-screen icon, and the
  documentation site and the README use it too.
- Citation metadata: GitHub's "Cite this repository" button gives APA and
  BibTeX for eduLIMS from `CITATION.cff`, and once Zenodo is connected every
  release is archived there with a DOI, described by `.zenodo.json`.
- A documentation site at https://edulims.eu, with a landing page, user
  guides for students, teachers and administrators in English and Dutch,
  the operations guides (install with Docker Compose, configuration
  reference, identity providers, upgrading, backups, verifying releases) and
  the design documents, built from `docs/` on every change to `main`.
- A user can be a teacher and an administrator at the same time and switches
  between the Teacher portal and the Admin portal with the portal switcher at
  the top of the sidebar, or with Alt+1 and Alt+2 (Option on a Mac). eduLIMS
  opens the portal last picked at the next sign-in, and the user menu lists
  every role. Each role keeps only its own access. Every role an identity
  provider sends counts, whether assigned directly or through a group; a
  student role combined with teacher or administrator refuses the sign-in
  with a message to contact the administrator. Upgrade step: the
  `edulims-migrate` service applies the migration that adds the nullable `user.last_portal` column and a
  check that `user.role` holds an allowed role set.
- Container images for eduLIMS (`ghcr.io/vernum-projecten/edulims`) and its
  database migrations (`ghcr.io/vernum-projecten/edulims-migrate`) on
  distroless Node.js 26, for linux/amd64 and linux/arm64, with SLSA Build L3
  provenance and SBOM attestations, a Trivy gate before tagging and a weekly
  rescan of the published images.
- A production `compose.yaml` that runs eduLIMS beside FerroEHR and
  FerroBRIDGE on one PostgreSQL 18 server, with Keycloak as an optional
  profile, and a `compose.dev.yaml` with PostgreSQL and a ready Keycloak realm
  for `pnpm dev`.

### Changed

- The Admin portal overview fits one screen: compact account tiles, the integrations beside the latest activity, and each integration's state next to its name (#129).
- Set `FERROBRIDGE_MLLP_BIND_HOST` to the host's lab-facing address and admit only the analysers' fixed addresses to the MLLP port in the host firewall (`DOCKER-USER` chain), as `docs/deployment.md`, "The MLLP port", describes (#186).
- List pages keep their search and pager in view and scroll only the rows, every role has one icon everywhere, the roles editor greys out roles that do not go together, a class lists its teachers and students apart, and a new join code comes with a ready invitation text to copy (#187).
- On a class page a member or invitation row shows a short button for one action, and a row menu for several, in place of long buttons that repeat the name (#207).
- The deployment guide now states what FerroBRIDGE 0.0.24 requires for the HL7 v2 listener: MLLP over TLS, the `[hl7v2.tls]` files, and a client certificate with a `certificate_subject` for every `[[hl7v2.senders]]` entry, or FerroBRIDGE does not start. The Afinion 2 has no TLS, so keep `[hl7v2] enabled = false` until a FerroBRIDGE release adds address-bound plain MLLP for devices (FerroBRIDGE#1918); the bind address and the firewall allow-list stay. Check your `ferrobridge.toml` with `docker compose run --rm --no-deps ferrobridge config check` (#211).
- Signing in with a second identity provider (Entra ID or Keycloak) under the email address of a user who signs in through the other one is now refused with a clear message, so one provider can never take over another provider's account (#39).
- eduLIMS now connects to PostgreSQL over TLS and verifies the server certificate in production, and refuses to start when `DATABASE_URL` lacks `sslmode=verify-full` (#40).
  Upgrade step: create `config/postgres-tls/ca.crt`, `server.crt` and `server.key` before you start the new `compose.yaml` (docs/deployment.md, "Database TLS"). A `DATABASE_URL` you set yourself needs `?sslmode=verify-full`.
- Pages and data for signed-in users are no longer kept in the browser or a shared cache: every page, server function and API response now sends `Cache-Control: no-store`, so the back button on a shared lab computer cannot show the previous user's portal (#41).
- A sign-in now lasts 8 hours after you last used eduLIMS and never longer than 24 hours after you signed in, so a session left open on a shared lab computer ends by the next day at the latest (#42).
  Upgrade step: the new database migration runs on its own with `edulims-migrate`.
- Over https the sign-in cookie and the language, theme and sidebar cookies now carry the `__Host-` prefix, which ties them to the exact eduLIMS address (#43).
  Upgrade step: the cookies get new names, so everyone signs in once more after the update and picks their language and theme again unless the language is saved on their account.
- The `edulims-migrate` image is now the eduLIMS tools image: it still migrates by default, and also runs `prune`, `admin grant|revoke` and `idp add|list|enable|disable|rekey` through `docker compose run`; `docker compose run --rm edulims-migrate prune` runs the retention prune on demand (#46).
- The **Users and roles** table has one toolbar row with a search that
  filters while you type, multi-select filters for role, sign-in method and
  status with the number of users per value, **Reset**, and **View** to hide
  columns, plus sorting from each column header and first, previous, next
  and last page. A row menu views the details, ends all sessions, or blocks
  and unblocks a user, and selected rows can have their sessions ended or be
  blocked with one reason at once, never the administrator's own account,
  each action confirmed and recorded per user in the activity log (B1, B4) (#58).
- The block and role forms in the Admin portal move focus to the first field
  with an error when you submit, and keep each error on screen until you
  correct it, also when you move on to another field (#61).
- A screen or user details panel whose data fails to load now says so and offers **Try again**, a list that refreshes in the background shows "Updating…" without moving, and a language or portal choice shows at once and goes back with a message when it cannot be saved. Signing out clears the data the page had loaded, so the next person at a shared computer sees none of it (#62).
- The app container now removes activity-log events older than 12 months, sessions that expired more than 30 days ago and unused expired administrator grants on its own, a minute after it starts and every 24 hours after, and logs each run in the activity log (B4, #65).
  Upgrade step: remove the host cron job or systemd timer that ran `docker compose run --rm edulims-migrate prune`; the command still works by hand.
- The sign-in page keeps a field error when you leave the field, moves focus to the first field to fix after a refused submit, and shows a refused sign-in (wrong password, a blocked account, an unknown institution email) at the field or the top of the form; it shows a retry when the sign-in options cannot load (S1, #84).
- The host commands now write to the security log stream: `idp rekey` records a `sys_data_key_rotated` event, a refused `admin grant`, `admin revoke`, `idp add`, `idp enable` or `idp disable` records a `refused` event with its reason code, and a failing `migrate`, `prune` or other command writes a `migration_failed`, `retention_prune_failed` or `cli_command_failed` JSON line with error classes and codes; the error message stays on the command's own output (B4, #86).
  `idp add --enable` now exits 1 and names the reason when the enable is refused, and the `fields` of an `idp_updated` event are a JSON list of field names, so a long list no longer arrives as `redacted` (#95).
- A disabled identity provider stops sign-ins and ends its sessions at once, also when another process disabled it. Any change to a provider's issuer needs a new client secret, and `admin grant --user-id` (after `admin lookup <email>`) makes an administrator on a provider whose email addresses are not verified, logged as an override (#92).
- The interface is English by default and available in Dutch. A language
  switcher in the header stores the choice in the `EDULIMS_LOCALE` cookie;
  without one, eduLIMS follows the browser's `Accept-Language`. Dates and
  numbers follow the chosen language, with times in Europe/Amsterdam.
- The roles are now `student`, `teacher` and `admin`, with the portals at
  `/student`, `/teacher` and `/admin`. Upgrade step: rename the identity
  provider roles to `edulims-teacher` and `edulims-admin` (the default
  `OIDC_ROLE_MAP` is
  `edulims-student:student,edulims-teacher:teacher,edulims-admin:admin`), or
  set `OIDC_ROLE_MAP` to your existing role names.
- The Microsoft button reads "Sign in with Microsoft". The Keycloak button
  reads "Sign in with Keycloak" in the chosen language unless `KEYCLOAK_LABEL`
  is set, which now has no default.
- The language buttons in the header are now one language menu, and a
  signed-in user's choice is saved to their account and applied at every next
  sign-in, on any device. Upgrade step: the
  `edulims-migrate` service applies the migration that adds the
  nullable `user.locale` column.

### Removed

- Identity providers are no longer configured in `.env`: `MICROSOFT_*`, `KEYCLOAK_ISSUER`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET`, `KEYCLOAK_LABEL`, `OIDC_ROLE_CLAIM`, `OIDC_ROLE_MAP` and `OIDC_DEFAULT_ROLE` are gone. Upgrade step: set the new required `EDULIMS_DATA_KEY` (`openssl rand -base64 32`), then add the first provider with `docker compose run --rm edulims-tools idp add` (docs/deployment.md, "First start") (#46).

### Fixed

- The sidebar's background and edge now run the full height of a long page when it is printed or captured as a full-page screenshot (#112).
- A refusal from the server stays on screen until you change the form or send it again: a message at the top of a form no longer disappears when you press Enter in a field, an unchanged value can be sent again after a refusal, and the first click on the send button after a refusal works. Focus moves to the field a refusal marks, and a refused block now shows its reason in the block dialog (#120).
- Users created outside the sign-in flow (by the seed or by directory provisioning) now appear under **Active** and **Never signed in** on Users and roles, and in the status counts, instead of under no status (#121).
- An empty variable in the environment file now counts as unset, so an empty identity-provider block switches that provider off, and the example file sets `NODE_ENV=development` and the development login for local use (#15).
- `NODE_ENV` is no longer set in the environment file: with `NODE_ENV=development` there, `pnpm build` produced a server that failed every page. `pnpm db:seed` and `pnpm db:reset` set development themselves. Remove a `NODE_ENV` line from your own environment file (#19).
- Two quick filter, sort or page changes on the users, activity log, classes and analyser tables now both apply: a second pick made before the page caught up no longer drops the first (#194).
- The admin role no longer carries better-auth's impersonation and credential actions, so an administrator cannot sign in as a student or change sign-in credentials (#2).
- A sign-in link can no longer send you to another website after you sign in: the redirect target now refuses control characters, whitespace and backslashes and must stay on eduLIMS (#29).
- Destructive buttons, badges and error text reach the 4.5:1 contrast WCAG 2.1 AA asks for in the light and the dark theme, and the admin user screens use the standard destructive buttons again (#54).
- Screen readers announce the close buttons of sheets and dialogs, the mobile menu and the other built-in control labels in Dutch when the interface is Dutch, and date pickers follow the interface language. Notifications follow the dark theme (#55, #27).
- FerroBRIDGE starts in the production stack again: `compose.yaml` gives it
  the CDR address as `FERROBRIDGE__CDR__ENDPOINT__URL`, the key FerroBRIDGE
  0.0.24 accepts, where it refused the old `FERROBRIDGE__CDR__BASE_URL` and
  did not start. Upgrade step: take the new `compose.yaml`; an operator who
  set the old key in an override file renames it (#93).
- Signing out of eduLIMS through Keycloak now returns you to the eduLIMS sign-in page instead of Keycloak's "You are logged out" page. A production Keycloak client needs `<BETTER_AUTH_URL>/login` as a valid post logout redirect URI.

[Unreleased]: https://github.com/Vernum-Projecten/eduLIMS/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Vernum-Projecten/eduLIMS/releases/tag/v0.1.0
