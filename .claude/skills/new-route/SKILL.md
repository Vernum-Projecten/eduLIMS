---
name: new-route
description: Scaffolds a TanStack Start route for one of the portals with its role guard, a GET server function with session, role and ownership checks and Zod input validation, a query-options factory, a loader that warms the cache with ensureQueryData, a useSuspenseQuery component with a Dutch title, and the unit and role-isolation tests. Use when adding a page or screen to the Student, Docent or Beheer portal.
allowed-tools: Read, Grep, Glob, Write, Edit, Bash
argument-hint: "<portal>/<path> e.g. docent/practica/$practicumId"
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
3. Pick names: area `practica`, route file
   `src/routes/_authed/docent/practica/$practicumId.tsx`, server code in
   `src/server/practica/`.

## The pieces

**`src/server/practica/functions.ts`**: the server function. Session, role
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

export const practicumInput = z.object({ practicumId: z.uuid() });

/** Returns one practicum the signed-in docent owns (D1, D3). */
export const getPracticum = createServerFn({ method: "GET" })
  .middleware([requireRole("docent")])
  .validator(practicumInput)
  .handler(async ({ data, context }) => {
    const row = await db
      .selectFrom("practica")
      .select(["id", "title", "deadline"])
      .where("id", "=", data.practicumId)
      .where("owner_id", "=", context.user.id)
      .executeTakeFirst();
    if (row === undefined) throw notFound();
    return { id: row.id, title: row.title, deadline: row.deadline.toISOString() };
  });
```

**`src/server/practica/queries.ts`**: the query-options factory.

```ts
import { queryOptions } from "@tanstack/react-query";
import { getPracticum } from "./functions";

export const practicumQueryOptions = (practicumId: string) =>
  queryOptions({
    queryKey: ["practica", practicumId],
    queryFn: () => getPracticum({ data: { practicumId } }),
  });
```

**The route file**: loader warms the cache, the component reads it with
`useSuspenseQuery`, the head sets a Dutch title.

```tsx
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { practicumQueryOptions } from "@/server/practica/queries";

export const Route = createFileRoute("/_authed/docent/practica/$practicumId")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(practicumQueryOptions(params.practicumId)),
  head: () => ({ meta: [{ title: "Practicum | eduLIMS" }] }),
  component: PracticumPage,
});

function PracticumPage() {
  const { practicumId } = Route.useParams();
  const { data } = useSuspenseQuery(practicumQueryOptions(practicumId));
  return (
    <main id="main" className="mx-auto max-w-5xl p-6">
      <h1 className="text-2xl font-semibold">{data.title}</h1>
    </main>
  );
}
```

Every hand-written file gets the SPDX header. Do not touch
`src/routeTree.gen.ts`; run `pnpm dev` or `pnpm build` and the plugin adds
the route.

## Tests

- **Unit** (`src/server/practica/functions.test.ts` or `tests/unit/`): the
  handler's query returns only the owner's practicum, against the Compose
  PostgreSQL with the fixed test set (`testing.md`).
- **Role isolation**, one case per refusal: a student gets 403; a docent
  asking for another docent's practicum gets 404; an anonymous call is
  refused. Cite the requirement in the test name (D3).
- **E2E** (`tests/e2e/`): the page renders for its role, the axe scan finds
  zero WCAG 2.1 A/AA violations, and the main task works with the keyboard.

## Finish

Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, then `/ui-gates` for the
page. Report results verbatim.
