---
paths:
  - "src/routes/**"
  - "src/router.tsx"
  - "src/start.ts"
  - "src/server/**"
  - "src/lib/**"
  - "src/components/**"
  - "vite.config.ts"
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# TanStack Start, Router, Query, Form and Table

eduLIMS is a full-SSR TanStack Start app (Vite 8, Nitro). Answer API questions
from the pinned packages, never from memory: the library skills pnpm links
into `.claude/skills/` (`react-start`, `react-router`, `router-query`,
`table-state`, `getting-started`) match the installed versions, and the
`tanstack` MCP server or Context7 serve the current docs. Where a skill and a
blog snippet disagree, the installed type definitions under `node_modules/`
decide. In the pinned Start version the server-function input API is
`.validator(…)`.

## Routes

- **File-based routing** under `src/routes/`. The plugin writes
  `src/routeTree.gen.ts`; **never edit it** (the
  `generated_file_guard.sh` hook blocks it). `pnpm dev` or `pnpm build`
  regenerates it.
- **Layout routes carry the access model:** a pathless `_authed` layout whose
  `beforeLoad` reads the session (through a server function) and redirects to
  the login route, and one layout per portal (`_authed/student`,
  `_authed/teacher`, `_authed/admin`) whose `beforeLoad` checks the role and
  throws `redirect` or `notFound`. This is navigation UX only. **Every server
  function checks the session and role again**, because a server function is
  an HTTP endpoint anyone can call (`auth-security.md`).
- **Search params are typed:** `validateSearch` with a Zod schema for every
  route that reads them (filters on the KPI dashboard: class, practical,
  period).
- **Every route sets `head()`** with a translated title (WCAG 2.4.2) and has an
  `errorComponent` or inherits one, plus `notFoundComponent` where an id in
  the URL can miss.
- `/new-route` scaffolds a route with its loader, server function and test.

## Data loading: loader + ensureQueryData, then useSuspenseQuery

The router and Query are wired through `setupRouterSsrQueryIntegration`
(`src/router.tsx`), so a query the loader warms on the server streams to the
client with the HTML.

1. Define a **query-options factory** next to the server function it calls
   (`src/server/<area>/queries.ts`): a stable `queryKey` array starting with
   the area (`["samples", practicalId]`) and a `queryFn` that calls the server
   function.
2. The route **loader** calls
   `context.queryClient.ensureQueryData(samplesQueryOptions(practicalId))`.
   It returns nothing the component needs directly; the cache is the channel.
3. The component reads with `useSuspenseQuery(samplesQueryOptions(id))`,
   which never shows an empty first paint after SSR.
4. A **mutation** calls the server function through `useServerFn` inside
   `useMutation`, and on success invalidates the affected keys
   (`queryClient.invalidateQueries({ queryKey: ["samples", id] })`) or calls
   `router.invalidate()` when loader data changed.

Do not call `fetch` to your own API from a component, and do not add API
routes for what a server function does. A server route (`server.handlers`)
is for a real HTTP contract: the better-auth handler under `/api/auth/*`, a
health check for B3, a file download such as the CSV export (D6).

## Server functions

```ts
export const registerSample = createServerFn({ method: "POST" })
  .middleware([requireRole("student")])
  .validator(registerSampleInput)
  .handler(async ({ data, context }) => {
    // context.user comes from the middleware; data is parsed by Zod.
  });
```

- **`method: "GET"` for reads, `"POST"` for writes.** A write never hides in
  a GET.
- **Order:** middleware (session and role) first, then `.validator()` with a
  Zod schema, then the handler. The handler trusts only `data` and
  `context`.
- **Return plain serialisable data** shaped for the screen: no Kysely row
  objects with columns the role may not see, no `Date` surprises (return ISO
  strings or let the serializer handle them consistently).
- **Errors:** throw `notFound()`, `redirect()`, or a typed error; never leak
  a stack trace or SQL text to the client.
- Server functions live in `src/server/<area>/` and import the database, the
  FerroEHR client and the auth instance from there. A component imports the
  server function, never the database.

## Forms and tables

- Forms are TanStack Form with shadcn `Field` (`react-ui.md` §2, `/new-form`).
- Tables are TanStack Table v9 rendered with the shadcn `Table` primitives.
  Sorting, filtering and pagination of large sets run on the server; the URL
  search params hold the table state so a teacher can share a filtered view.

## SSR hygiene

- No `window`, `document` or `localStorage` at module scope or during
  render; use an effect or `createClientOnlyFn`.
- Hydration must match: no `Date.now()` or random values in render output.
- `ssr: false` on a route is a last resort for a browser-only widget and needs
  a reason in the PR.
