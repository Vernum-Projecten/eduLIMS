<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# 0011. English code and an internationalised UI with Paraglide JS

- Status: Proposed
- Date: 2026-11-11
- Deciders: Ruben Talstra (maintainer)

## Context and problem statement

eduLIMS started with Dutch role values (`docent`, `beheerder`), Dutch route
paths (`/docent`, `/beheer`) and Dutch UI text written straight into the
components, next to English code and comments. Mixing the two languages in
identifiers makes the code harder to read for contributors outside the
Netherlands, and hard-coded Dutch text makes the product unusable for anyone
who does not read Dutch. The owner decided that the product is generic: no
institution or person names, and a professional English and Dutch interface
that never mixes the two languages on one screen.

Which language do the code and the stored values use, and how does the UI
pick and render its language under full SSR with TanStack Start?

## Decision drivers

- No hydration mismatch: the server and the browser render the same language.
- A missing or misspelt message key fails `tsc`.
- Only the messages a page uses reach the browser.
- Works with TanStack Router and Start without a URL prefix per language.
- Exact, recent, maintained versions; no network access at build time.

## Considered options

1. **Paraglide JS** (`@inlang/paraglide-js` 3.2.1), compiler-first. TanStack
   Router's i18n guide documents it for Start and runs its
   `start-i18n-paraglide` example in CI.
2. **use-intl** 4.15.0, the runtime of next-intl: a provider with a message
   object, typed through module augmentation.
3. **react-i18next** 18.0.1: runtime dictionaries, typing through
   declaration merging, a provider and an SSR setup of our own.
4. **Lingui** 6.12.0: macros and extraction into compiled catalogues, which
   needs a Babel or SWC macro step in the Vite pipeline.

## Decision outcome

Chosen option: **Paraglide JS**, because it is the option the TanStack docs
document for Start, it compiles every message to a typed ES function (a
missing key is a compile error, and unused messages are tree-shaken), and its
server middleware isolates the locale per request with `AsyncLocalStorage`,
so no provider or context has to thread through the tree.

### Code and data

- All code, identifiers, comments, file names, route paths, log messages,
  test names and stored values are English. The roles are `student`,
  `teacher` and `admin` (routes `/student`, `/teacher`, `/admin`); the IdP
  role names are `edulims-student`, `edulims-teacher` and `edulims-admin`,
  so the default `OIDC_ROLE_MAP` is
  `edulims-student:student,edulims-teacher:teacher,edulims-admin:admin`.
  This amends the role names in [0010](0010-vendor-neutral-oidc-entra-and-keycloak.md).
- There is no deployed data, so the role values changed in place, without a
  data migration. The schema stores the role as free text and has no
  constraint or seed that names a role.

### Locales and messages

- English (`en`) is the source and default locale, Dutch (`nl`) the second.
  Messages live in `messages/en.json` and `messages/nl.json` (inlang message
  format); `project.inlang/` holds the settings and the compiler options.
- The message-format plugin loads from `node_modules` (pinned in the
  lockfile), not from a CDN, so the build needs no network.
- The compiler writes physical modules to `src/i18n/` (git-ignored). The Vite
  plugin compiles on `pnpm dev` and `pnpm build`; `pnpm i18n` compiles for
  `tsc` and Vitest. Code imports `m` from `@/i18n/messages`.
- `tsc` proves every key the code uses exists in English. A unit test proves
  every locale has the same keys and placeholders as English, because
  Paraglide would otherwise fall back to English without a warning.

### Choosing the locale

- Order: the `EDULIMS_LOCALE` cookie, then `Accept-Language`, then English.
  `src/server-entry.ts` wraps the Start handler in `paraglideMiddleware`, so
  pages, server functions and server routes all render in the request's
  locale, and `<html lang>` follows it.
- In the browser a custom strategy reads `<html lang>`, the locale the server
  rendered, before `navigator.languages`, which can disagree with
  `Accept-Language`. Hydration therefore never switches language.
- The switcher in the header sets the cookie and reloads the document. A
  locale switch is rare, and a reload re-renders the server-side `head()`
  titles and the loader data in the new language.
- No URL prefix. The Paraglide and TanStack docs show `/en/…` routes with a
  router `rewrite` for public, indexed sites; eduLIMS sits behind a sign-in,
  so one URL per page is simpler and the cookie is enough. A prefix can be
  added later through `urlPatterns` and the router `rewrite`.

### Formatting

Dates, times and numbers go through `Intl` with the active locale
(`src/lib/i18n/format.ts`), and dates and times show in `APP_TIME_ZONE`
(`Europe/Amsterdam`), a code constant. Instants stay UTC in storage and in
comparisons.

### Provider buttons

The Entra button reads "Sign in with Microsoft" ("Inloggen met Microsoft").
The Keycloak button reads "Sign in with Keycloak" in the active locale;
`KEYCLOAK_LABEL`, when set, replaces it with the operator's text in every
locale.

## Consequences

- Good: one language in the code; Dutch appears only in `messages/nl.json`.
- Good: a missing key fails the type check, a missing translation fails a
  unit test, and an e2e test proves that switching to Dutch changes the UI
  and `<html lang>`.
- Good: no build-time network access, and no i18n provider in the React tree.
- Bad: `pnpm typecheck` and `pnpm test` compile the messages first, because
  the generated modules are not committed.
- Bad: a locale switch reloads the page.
- Bad: Paraglide 3 is young (3.0.0 shipped on 2026-11-03); 3.2.2 was inside
  pnpm's minimum release age, so 3.2.1 is pinned.
- Neutral: `KEYCLOAK_LABEL` is one string for every locale. An operator who
  needs it localised leaves it unset.
