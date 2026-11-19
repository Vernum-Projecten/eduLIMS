---
name: new-route
description: Scaffolds a TanStack Start route for one of the portals with its role guard, a GET server function with session, role and ownership checks and Zod input validation, a key factory with colocated query and mutation options, a loader that warms the cache with ensureQueryData, a useSuspenseQuery component with a translated title from the i18n layer and the loading, error, empty and updating states, and the unit and role-isolation tests. Use when adding a page or screen to the Student, Teacher or Admin portal.
allowed-tools: Read, Grep, Glob, Write, Edit, Bash
argument-hint: "<portal>/<path> e.g. teacher/simulations/$simulationId"
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# /new-route

Scaffold one route, following `.claude/rules/tanstack.md`,
`auth-security.md` and `react-ui.md`. Read those first, and read the
installed library skills (`.claude/skills/react-start`, `router-query`) for
the exact API of the pinned versions.

## Before you write

1. **Find the requirement** the screen serves (`/requirement-lookup`) and the
   role that may see it. If the draft does not say who may see what, stop and
   ask the owner; access rules are never guessed.
2. **Find the existing pieces** with Grep: the portal layout
   (`src/routes/_authed/<portal>/route.tsx` or similar), the auth middleware
   in `src/server/auth/` (`requireSession`, `requireRole`), the `db`
   instance in `src/server/db/`. If the auth middleware does not exist yet,
   the route waits for it: report that instead of inventing one inline.
3. Pick names: area `simulations`, route file
   `src/routes/_authed/teacher/simulations/$simulationId.tsx`, server code in
   `src/server/simulations/`.
4. **Find the i18n layer** (ADR 0011): the message catalogues under
   `messages/` (`en` is the source, `nl` the translation) and the import the
   existing routes use for message functions. The snippets below write it as
   `m` from `@/i18n/messages`; use the real path. Add every new key to both
   catalogues.

## The pieces

**`src/server/simulations/functions.ts`**: the server function. Session, role
and ownership first, then validation, then a query that filters by owner in
SQL.

```ts
// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { createServerFn } from "@tanstack/react-start";
import { notFound } from "@tanstack/react-router";
import { z } from "zod";
import { requireRole } from "@/server/auth/middleware";
import { db } from "@/server/db";

export const simulationInput = z.object({ simulationId: z.uuid() });

/** Returns one simulation of the signed-in teacher (D10, D11). */
export const getSimulation = createServerFn({ method: "GET" })
  .middleware([requireRole("teacher")])
  .validator(simulationInput)
  .handler(async ({ data, context }) => {
    const row = await db
      .selectFrom("simulations")
      .select(["id", "name", "created_at"])
      .where("id", "=", data.simulationId)
      .where("owner_id", "=", context.user.id)
      .executeTakeFirst();
    if (row === undefined) throw notFound();
    return { id: row.id, name: row.name, createdAt: row.created_at.toISOString() };
  });
```

**`src/server/simulations/query-options.ts`**: the Query layer of the area
(`tanstack.md` §Query conventions; `src/server/users/query-options.ts` is the
reference). One key factory from wide to narrow, the `queryOptions` of each
read with its `staleTime` from `STALE_TIME` (`src/lib/query-config.ts`; add
the domain there and to the table in the rule), and a `mutationOptions`
factory per write that invalidates only the keys it changed.

```ts
// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { mutationOptions, type QueryClient, queryOptions } from "@tanstack/react-query";
import { STALE_TIME } from "../../lib/query-config.ts";
import { getSimulation } from "./functions.ts";

/** The query keys of the simulations, from the widest to the narrowest. */
export const simulationsKeys = {
  all: ["simulations"] as const,
  details: () => [...simulationsKeys.all, "detail"] as const,
  detail: (simulationId: string) => [...simulationsKeys.details(), simulationId] as const,
};

/** One simulation of the signed-in teacher. */
export function simulationQueryOptions(simulationId: string) {
  return queryOptions({
    queryKey: simulationsKeys.detail(simulationId),
    queryFn: () => getSimulation({ data: { simulationId } }),
    staleTime: STALE_TIME.simulations,
  });
}

/** Renames a simulation; invalidates that simulation and nothing else. */
export function renameSimulationMutationOptions(queryClient: QueryClient, call: RenameCall) {
  return mutationOptions({
    mutationFn: (data: RenameInput) => call({ data }),
    onSettled: (_result, _error, data) =>
      queryClient.invalidateQueries({ queryKey: simulationsKeys.detail(data.simulationId) }),
  });
}
```

**The route file**: the loader warms the cache, the component reads it with
`useSuspenseQuery`, the head sets a translated title, and the route has all
four states. No user-visible string is hard-coded.

```tsx
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { RouteErrorState } from "@/components/shell/route-error";
import { UpdatingIndicator } from "@/components/shell/updating-indicator";
import { m } from "@/i18n/messages";
import { simulationQueryOptions } from "@/server/simulations/query-options";

export const Route = createFileRoute("/_authed/teacher/simulations/$simulationId")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(simulationQueryOptions(params.simulationId)),
  head: () => ({ meta: [{ title: m.simulation_page_title() }] }),
  pendingComponent: SimulationSkeleton, // loading: shadcn Skeleton in the page's layout
  errorComponent: RouteErrorState, // error: an alert and "Try again"
  component: SimulationPage,
});

function SimulationPage() {
  const { simulationId } = Route.useParams();
  const { data, isFetching } = useSuspenseQuery(simulationQueryOptions(simulationId));
  return (
    <div className="relative" aria-busy={isFetching || undefined}>
      <UpdatingIndicator active={isFetching} />
      {/* empty: shadcn Empty with a translated title and description when there is nothing */}
    </div>
  );
}
```

The four states, every data route:

- **Loading:** a `pendingComponent` with shadcn `Skeleton` in the shape of
  the page (`PageSkeleton`, `DataTableSkeleton`).
- **Error:** `errorComponent: RouteErrorState` (or, inside a sheet or
  dialog, a component that calls `useRouteRetry(reset)`), so the retry
  resets the Query error boundary and runs the loader again. A list read with
  `useQuery` sets `throwOnError` when it has no data to show.
- **Empty:** shadcn `Empty` with a translated title and description.
- **Background refetch:** `UpdatingIndicator` from `isFetching` in a slot
  that is always there, so nothing moves; the region gets `aria-busy`.
  A paginated or filtered list uses `placeholderData: keepPreviousData`
  and the `cause: "stay"` loader of `src/routes/_authed/admin/users.tsx`.

Never write a key array outside the factory, never call
`invalidateQueries()` without a key, and keep server data out of React
state, context and stores: the cache is the only copy.

Every hand-written file gets the SPDX header. Do not touch
`src/routeTree.gen.ts`; run `pnpm dev` or `pnpm build` and the plugin adds
the route.

## Tests

- **Unit** (`src/server/simulations/functions.test.ts` or `tests/unit/`): the
  handler's query returns only the teacher's own simulation, against the Compose
  PostgreSQL with the fixed test set (`testing.md`).
- **Role isolation**, one case per refusal: a student gets 403; a teacher
  asking for another teacher's simulation gets 404; an anonymous call is
  refused. Cite the requirement in the test name (D11). A Student portal
  route also proves that a student of another team gets 404 and that the
  response holds no correct value or accuracy status (S10, Q-SIM-1).
- **Query layer** (`src/server/simulations/query-options.test.ts`): one case
  per mutation that it invalidates only its keys, and one per optimistic
  update that it rolls back on a server error, with the helpers in
  `src/lib/test-query-client.ts`.
- **E2E** (`tests/e2e/`): the page renders for its role, the axe scan finds
  zero WCAG 2.1 A/AA violations, the main task works with the keyboard, and
  a forced 500 on the read shows the error state whose retry recovers
  (`tests/e2e/query-states.spec.ts`).

## Finish

Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, then `/ui-gates` for the
page. Report results verbatim.
