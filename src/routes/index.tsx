// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { portalPathFor } from "@/server/authz";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const { user } = Route.useRouteContext();
  const portal = user ? portalPathFor(user) : null;

  return (
    <section aria-labelledby="home-title" className="max-w-3xl">
      <h1 id="home-title" className="text-3xl font-semibold">
        eduLIMS
      </h1>
      <p className="mt-2 text-muted-foreground">
        Laboratory Information Management System voor het practicumonderwijs van LifeScience.
      </p>
      <div className="mt-6">
        {portal ? (
          <Button asChild>
            <Link to={portal}>Naar mijn portaal</Link>
          </Button>
        ) : user ? (
          <p>Je account heeft nog geen rol. Neem contact op met een beheerder.</p>
        ) : (
          <Button asChild>
            <Link to="/login">Inloggen</Link>
          </Button>
        )}
      </div>
    </section>
  );
}
