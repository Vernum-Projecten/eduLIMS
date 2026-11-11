// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { m } from "@/i18n/messages";
import { portalPathFor } from "@/server/authz";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "eduLIMS" }] }),
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
      <p className="mt-2 text-muted-foreground">{m.app_description()}</p>
      <div className="mt-6">
        {portal ? (
          <Button asChild>
            <Link to={portal}>{m.home_go_to_portal()}</Link>
          </Button>
        ) : user ? (
          <p>{m.home_no_role()}</p>
        ) : (
          <Button asChild>
            <Link to="/login">{m.sign_in()}</Link>
          </Button>
        )}
      </div>
    </section>
  );
}
