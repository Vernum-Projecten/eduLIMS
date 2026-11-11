// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { LogInIcon } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { PublicLayout } from "@/components/shell/public-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from "@/components/ui/card";
import { m } from "@/i18n/messages";
import { portalPathFor } from "@/server/authz";

export const Route = createFileRoute("/")({
  // A signed-in user goes straight to their portal; only a user without a role stays here.
  beforeLoad: ({ context }) => {
    const portal = context.user ? portalPathFor(context.user) : null;
    if (portal) throw redirect({ to: portal });
  },
  head: () => ({ meta: [{ title: "eduLIMS" }] }),
  component: Home,
});

function Home() {
  const { user } = Route.useRouteContext();

  return (
    <PublicLayout signedIn={user !== null}>
      <div className="flex flex-1 items-center justify-center">
        <Card className="w-full max-w-md">
          <section aria-labelledby="home-title" className="contents">
            <CardHeader className="items-center text-center">
              <BrandMark className="mx-auto mb-2 size-14" />
              <h1 id="home-title" className="text-3xl font-semibold tracking-tight">
                eduLIMS
              </h1>
              <CardDescription className="text-base text-balance">
                {m.app_description()}
              </CardDescription>
            </CardHeader>
            <CardContent className="text-center text-sm text-muted-foreground">
              {user ? (
                <p role="status" className="text-foreground">
                  {m.home_no_role()}
                </p>
              ) : (
                <p>{m.home_sign_in_hint()}</p>
              )}
            </CardContent>
            {!user && (
              <CardFooter className="justify-center">
                <Button asChild size="lg" className="w-full sm:w-auto">
                  <Link to="/login">
                    <LogInIcon aria-hidden="true" data-icon="inline-start" />
                    {m.sign_in()}
                  </Link>
                </Button>
              </CardFooter>
            )}
          </section>
        </Card>
      </div>
    </PublicLayout>
  );
}
