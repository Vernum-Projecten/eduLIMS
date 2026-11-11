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

# TanStack Start, Router, Query, Form, Table and Hotkeys

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

1. Define the area's **key factory and query options** next to the server
   function they call (`src/server/<area>/query-options.ts`; `queries.ts`
   holds the Kysely queries): keys from the factory, a `queryFn` that calls
   the server function, and the domain's `staleTime`.
2. The route **loader** calls
   `context.queryClient.ensureQueryData(samplesQueryOptions(practicalId))`.
   It returns nothing the component needs directly; the cache is the channel.
3. The component reads with `useSuspenseQuery(samplesQueryOptions(id))`,
   which never shows an empty first paint after SSR.
4. A **mutation** calls the server function through `useServerFn` inside
   `useMutation` with the area's `mutationOptions`, which invalidate the
   affected keys from the factory (`samplesKeys.detail(id)`), never a bare
   `invalidateQueries()`.

The router sets `defaultPreloadStaleTime: 0`, so the Query cache alone
decides what is fresh, and creates one `QueryClient` per request on the
server. Reads retry once (`QUERY_RETRY`) before the error state shows.

Do not call `fetch` to your own API from a component, and do not add API
routes for what a server function does. A server route (`server.handlers`)
is for a real HTTP contract: the better-auth handler under `/api/auth/*`, a
health check for B3, a file download such as the CSV export (D6).

## Query conventions

The Users screen (`src/server/users/query-options.ts`, #58) is the
reference; every area follows it.

- **One key factory per area**, from wide to narrow: `usersKeys.all`,
  `.lists()`, `.list(filters)`, `.details()`, `.detail(id)`. Never write a
  key array by hand outside the factory.
- **Options live beside the keys:** `queryOptions` for each read and a
  `mutationOptions` factory for each write, taking the `QueryClient` and the
  `useServerFn` caller. Cache logic (optimistic writes, rollback,
  invalidation) belongs in the factory; UI feedback (the toast) in the
  component (`useUsersMutation` wraps the factory's callbacks).
- **Targeted invalidation only:** a write invalidates `detail(id)` of each
  user it touched and `lists()`, in `onSettled`. Never a bare
  `invalidateQueries()` and never the area root unless every entry changed.
- **Lists keep the previous page** (`placeholderData: keepPreviousData`). The
  route loader awaits the list on `cause: "enter"` (SSR and first visit) and
  only starts it on `cause: "stay"` (a new sort, filter or page), so the
  table stays on screen; the component reads it with `useQuery` and shows a
  translated "Updating…" from `isFetching && isPlaceholderData` in a slot
  that does not move the layout.
- **Optimistic updates** where the result is certain (ending a session,
  editing a local role set): `onMutate` cancels the affected queries, writes
  the change into every cached list page and the detail, and returns the
  snapshot; `onError` restores it; the mutation function throws a refusal
  (`AdminActionRefused`) so a refused action rolls back like a failed one.
  An e2e journey forces a 500 on the write (`failServerWrites`) to prove the
  rollback.
- **Server data lives only in the Query cache:** no copy in React state,
  context or a store. Local state is for UI only (an open dialog, the row
  selection, a typed search before its debounce). A context may forward
  values the component just read from a query (`UsersTableContext`), never
  hold its own copy.
- **The session is a query too** (`src/lib/session.query-options.ts`,
  `sessionKeys.current()`). The root `beforeLoad` reads it with
  `fetchQuery` on every navigation (it is always stale) and hands the user
  to the guards in route context; that snapshot is the router's, not a
  second cache. Signing out empties the cache (`queryClient.clear()`), so
  the next person at a shared lab computer sees nothing of the last one.
- **Preferences** (`src/server/preferences/query-options.ts`): the landing
  portal is part of the session user, so saving it writes the session entry
  optimistically and rolls back on failure. The language is a cookie with a
  page reload, so its menu shows the pick from the mutation's `variables`
  while it is pending and falls back on failure; it invalidates no key. The
  theme is a device cookie with no server write, so it has nothing to roll
  back.

### staleTime per domain

Each factory sets `staleTime` from `STALE_TIME` in `src/lib/query-config.ts`;
a new domain adds its row here and there.

| Domain | `staleTime` | Why |
|---|---|---|
| Session (`sessionKeys`) | 0 | The guards decide on it; a role change or revoked session applies on the next navigation (B1). |
| Users table page (`usersKeys.list`) | 30 s | Other administrators change it, rarely within a minute; every action invalidates it anyway. |
| User detail sheet (`usersKeys.detail`) | 15 s | Its active sessions change on every sign-in. |
| Anything else (the `QueryClient` default) | 30 s | A fallback only; every factory sets its own. |

### Four states on every data route

- **Loading:** a `pendingComponent` with shadcn `Skeleton` in the page's
  shape (`DataTableSkeleton`, the user sheet's skeleton).
- **Error:** `errorComponent: RouteErrorState`
  (`src/components/shell/route-error.tsx`), or inside a sheet a component
  that calls `useRouteRetry(reset)`. Mounting resets the
  `QueryErrorResetBoundary`; "Try again" resets the route and calls
  `router.invalidate()`. A list read with `useQuery` sets `throwOnError`
  when it has no data to show, so a failed new page reaches the boundary
  while a failed background refetch keeps the page.
- **Empty:** shadcn `Empty` with a translated title and description.
- **Background refetch:** `UpdatingIndicator`
  (`src/components/shell/updating-indicator.tsx`) from `isFetching`, always
  rendered and only made visible, so nothing moves; the region carries
  `aria-busy`.

### Tests

- One unit case per mutation that it invalidates only its keys, and one per
  optimistic update that it rolls back on a server error, with
  `testQueryClient`, `seedCache`, `runMutation` and `invalidatedKeys` from
  `src/lib/test-query-client.ts`.
- An e2e case per data route that a forced 500 on the read shows the error
  state and its retry recovers (`tests/e2e/query-states.spec.ts`).

## Pacer

- Debounce and throttle with TanStack Pacer (`@tanstack/react-pacer`), never
  a hand-written timer. `useDebouncer(fn, { wait })` when the caller needs
  `flush()` (Enter applies a search at once) or `cancel()`;
  `useDebouncedCallback` or `useDebouncedValue` otherwise. The data table's
  search debounces 300 ms (`SEARCH_DEBOUNCE_MS`).

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
- Every list uses the reusable data table in `src/components/data-table/`
  (#58): the shared `dataTableFeatures`, `manualSorting`, `manualFiltering`
  and `manualPagination` with the server's `rowCount`, the slices controlled
  from `validateSearch` through `src/lib/data-table-state.ts`, hidden columns
  in a preference cookie (`src/lib/table-columns.ts`), and facet counts from
  the server computed with the other filters applied. The page's primary
  table passes `search.shortcut: true` to `DataTableToolbar`, which registers
  its search with `useRegisterSearchShortcut` (`/` and Mod+K); one per page.

## Charts

- Charts are TanStack Charts (`@tanstack/charts`, ADR 0016) rendered through
  `EduChart` (`react-ui.md` §4). The package ships its docs in
  `node_modules/@tanstack/charts/docs/`; read the installed version.
- `defineChart` with marks from the core (`dot`, `lineY`, `barY`, …), the
  compact scales from `@tanstack/charts/scales/*` with inferred domains, and
  `tooltip` from `@tanstack/charts/tooltip`; the React `Chart` is
  `@tanstack/charts/react`. No `d3-scale`: a non-linear mapping is a helper
  in `src/lib/charts/`.
- The adapter server-renders the SVG at `initialWidth` and adopts it after
  hydration. Keep the definition deterministic and memoized; pass the data
  the loader returned, never fetch inside a chart.

## Hotkeys: keyboard shortcuts

Keyboard shortcuts are `@tanstack/react-hotkeys` (the `react-hotkeys` skill
in `.claude/skills/`, and the `hotkeys-core` and `app-hotkeys` skills
shipped in `node_modules/@tanstack/hotkeys/skills/`). No hand-written
`keydown` listener on `window` or `document`; a widget's own `onKeyDown`
on its element stays fine.

- **One registry, `src/lib/shortcuts.ts`.** Every shortcut is defined there
  once: an id, its hotkeys (`Mod` for ⌘/Ctrl, physical `[Digit1]` codes where
  the key position matters), a scope and a translated `label`. Bindings and
  every display read it: `shortcutLabel` for a visible label (`⌥1`, `Ctrl+K`),
  `shortcutKeys` for `Kbd` parts, `ariaKeyShortcuts` for `aria-keyshortcuts`.
  Never type a key string in a component; the shortcuts dialog lists the
  registry, so a shortcut missing there is missing from the dialog.
- **Bind with `useHotkey`/`useHotkeys` where the action lives**, passing the
  registry's hotkeys and `meta: { name: label() }`. `ShortcutsProvider`
  (`src/components/shortcuts/`) wraps the signed-in shell in a
  `HotkeysProvider` with the user's platform (`useShortcutPlatform`, so `Mod`
  and the labels agree after hydration) and `ignoreDefaultPrevented` for
  Radix overlays.
- **Scopes:** `global` shortcuts work on every signed-in page (portal
  switching, `?`); `page` shortcuts exist only while the page that registers
  them is mounted (the search shortcut through `useRegisterSearchShortcut`).
  A dialog that owns the keyboard wraps its content in a `HotkeysProvider`
  with a per-instance `scope` and `exclusive`, as the shortcuts dialog does.
- **Never in inputs, never over an overlay.** Keep the default
  `ignoreInputs` for single keys and Alt/Shift chords, and set
  `ignoreInputs: true` on a `Mod` chord that must not fire in a field. A
  shortcut that would act behind an open dialog, sheet or menu sets
  `preventDefault: false`, returns when `isOverlayOpen(document)`, and
  prevents the default itself only when it acts.
- **Single-key shortcuts (WCAG 2.1.4):** a shortcut without Ctrl, Alt or ⌘
  (`isCharacterKeyShortcut`) is `enabled` only while
  `useCharacterKeyShortcuts()` is on; the dialog's switch turns them off.
- **Tests:** unit tests render the hook inside
  `<HotkeysProvider defaultOptions={{ platform }}>`, dispatch real
  `KeyboardEvent`s and call `HotkeyManager.resetInstance()` after each case;
  e2e emulates macOS and Windows through `navigator.platform`.

## Virtual: long lists that are not paginated

`@tanstack/react-virtual` renders only the rows in view
(<https://tanstack.com/virtual/latest>). Use it for a list that grows without
a page size (the activity log's infinite list, a large class roster); a table
the server already pages does not need it.

- **Use the shared pieces in `src/components/virtual/`**, never a bare
  `useVirtualizer` in a feature: `VirtualList` for a list, and
  `useVirtualRows` for anything else (the data table's virtual body). The
  index math and the keyboard model are pure functions in
  `src/lib/virtual-rows.ts`, unit-tested.
- **Accessibility holds over the window:** a list gives each item
  `aria-setsize` (the whole set) and `aria-posinset`; a table row gives
  `aria-rowindex` (`ariaRowPosition(index, headerRows)`) with `aria-rowcount`
  on the table. One row is the tab stop; arrow keys, Home, End, PageUp and
  PageDown move focus and scroll the row into view. The focused row stays
  rendered when it scrolls away, so focus is never dropped to `body`.
- **No inline style:** `useVirtualRows` sets `directDomUpdates`, so the
  virtualizer writes row offsets and the total height to the DOM itself.
  Rows are `absolute top-0 left-0` only once `positioned` is true.
- **SSR renders the first window:** `initialRect` gives the server a viewport
  height (match the CSS height); before the first layout effect rows sit in
  normal flow, which is where the first window is anyway, so the hydration
  render matches. Keys are stable ids (`getKey`), never the index.
- Rows may differ in height: `measureElement` measures each one; give an
  honest `estimateRowHeight`.
- The demo is `/dev/virtual` (10,000 fictional rows), a development-only
  route that is a 404 in a production build.

### A virtual data table or server pagination

- **Server pagination is the default for a large set**: the users table and
  every list the server sorts and filters pages on the server, with the
  state in the URL (§Forms and tables). Never load a whole large set into the
  browser to virtualise it.
- **`DataTable` with `virtual`** is for a long list that is not paginated:
  an infinite list that grows as the user scrolls, or a set the screen needs
  whole (a full roster, every well of an upload). Pass
  `virtual={{ estimateRowHeight, viewportHeight, className }}` with a height
  class that matches `viewportHeight`, so SSR renders the first window.
- The virtual body (`data-table-virtual-body.tsx`) renders each row as a flex
  row with explicit table roles, so the columns line up without inline
  widths: a cell takes an equal share unless its column meta sets a width
  (`className: "w-36 flex-none"`), and header and body cells get the same
  classes. It sets `aria-rowcount` and `aria-rowindex`, keeps the header
  sticky through `useVirtualRows`'s `scrollMargin`, and uses its keyboard
  model on the rows; a key inside a cell's control stays with that control.
- The demo is `/dev/virtual-table` (10,000 fictional rows, sortable by three
  columns), development-only like `/dev/virtual`.

## Devtools: development only

One TanStack Devtools panel (`@tanstack/react-devtools`) with the Router,
Query and Form plugins (<https://tanstack.com/devtools/latest>) lives in
`src/components/devtools/app-devtools.tsx`, all devDependencies.

- **Only `DevtoolsLoader` imports it**, through a dynamic `import()` behind
  `import.meta.env.DEV`, inside `ClientOnly`. A production build drops the
  import; `scripts/checks/no-devtools.sh` (CI `build` job) fails when a
  devtools marker or chunk reaches `.output/public/assets`.
- **Off under automation:** the loader renders nothing when
  `navigator.webdriver` is set, so Playwright and axe see the app alone, in
  the dev project too.
- **The Form plugin needs no registry:** every `useForm`, and the
  `useAppForm` built on it, reports to the devtools event bus by itself.
- A new devtools plugin goes in `app-devtools.tsx`, never in a route or a
  component.

## Dev-only routes and their e2e

A route under `src/routes/dev/` throws `notFound()` in `beforeLoad` unless
`getDevPagesEnabled()` (`src/lib/dev-tools.functions.ts`) says so: it reads
`NODE_ENV` on the server at request time, so the pages are served in
development and in the e2e build (`NODE_ENV=test`) and are a 404 in
production (ASVS V13.4, unit-tested in `src/server/dev-tools.test.ts`). Their
journeys are ordinary specs against the e2e build. Never gate a page on
`import.meta.env.DEV`; that is for code the production bundle must not
contain at all, such as the devtools.

## SSR hygiene

- No `window`, `document` or `localStorage` at module scope or during
  render; use an effect or `createClientOnlyFn`.
- Hydration must match: no `Date.now()` or random values in render output.
- `ssr: false` on a route is a last resort for a browser-only widget and needs
  a reason in the PR.
