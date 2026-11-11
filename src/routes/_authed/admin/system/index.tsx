// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRightIcon, KeyRoundIcon } from "lucide-react";
import { portalPageTitle } from "@/components/portal/portal-pages";
import { Page } from "@/components/shell/page-header";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { m } from "@/i18n/messages";
import { portalNavigation, sectionOf } from "@/lib/navigation";

export const Route = createFileRoute("/_authed/admin/system/")({
  head: () => ({
    meta: [{ title: portalPageTitle(portalNavigation("admin"), sectionOf("admin", "system")) }],
  }),
  component: SystemPage,
});

/** Admin → System: the settings of eduLIMS itself, one card per topic. */
function SystemPage() {
  const section = sectionOf("admin", "system");
  return (
    <Page title={section.label()} description={<p>{section.description()}</p>}>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <li className="flex">
          <Card className="relative w-full transition-colors focus-within:ring-3 focus-within:ring-ring/50 hover:bg-accent/50">
            <CardHeader>
              <span className="mb-2 flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <KeyRoundIcon aria-hidden="true" className="size-5" />
              </span>
              <CardTitle>
                <h2>
                  {/* The link covers the card, so the whole card is one target with one name. */}
                  <Link
                    to="/admin/system/identity-providers"
                    className="outline-none after:absolute after:inset-0 after:rounded-xl"
                  >
                    {m.idp_title()}
                  </Link>
                </h2>
              </CardTitle>
              <CardDescription>{m.idp_description()}</CardDescription>
              <CardAction>
                <ArrowRightIcon aria-hidden="true" className="size-4 text-muted-foreground" />
              </CardAction>
            </CardHeader>
          </Card>
        </li>
      </ul>
    </Page>
  );
}
