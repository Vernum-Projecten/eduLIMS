// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/student/")({
  head: () => ({ meta: [{ title: "Studentportaal | eduLIMS" }] }),
  component: Page,
});

function Page() {
  const { user } = Route.useRouteContext();
  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title" className="text-2xl font-semibold">
        Studentportaal
      </h1>
      <p className="mt-2">Welkom, {user.name}.</p>
      <p className="mt-1 text-muted-foreground">
        Hier vind je straks je practica, monsters, meetresultaten en beoordelingen.
      </p>
    </section>
  );
}
