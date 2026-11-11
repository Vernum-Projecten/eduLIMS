// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/teacher/")({
  head: () => ({ meta: [{ title: "Docentportaal | eduLIMS" }] }),
  component: Page,
});

function Page() {
  const { user } = Route.useRouteContext();
  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title" className="text-2xl font-semibold">
        Docentportaal
      </h1>
      <p className="mt-2">Welkom, {user.name}.</p>
      <p className="mt-1 text-muted-foreground">
        Hier beheer je straks je practica en bekijk je de resultaten van je studenten.
      </p>
    </section>
  );
}
