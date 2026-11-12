// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRightIcon, KeyRoundIcon } from "lucide-react";
import type { ReactNode } from "react";
import { SystemBuild, SystemProviders } from "@/components/admin-system/system-configuration";
import { portalPageTitle } from "@/components/portal/portal-pages";
import { Page } from "@/components/shell/page-header";
import { RouteErrorState } from "@/components/shell/route-error";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { m } from "@/i18n/messages";
import { portalNavigation, sectionOf } from "@/lib/navigation";
import { systemConfigurationQueryOptions } from "@/server/system/query-options";

export const Route = createFileRoute("/_authed/admin/system/")({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(systemConfigurationQueryOptions()).then(() => undefined),
  head: () => ({
    meta: [{ title: portalPageTitle(portalNavigation("admin"), sectionOf("admin", "system")) }],
  }),
  pendingComponent: SystemPendingPage,
  errorComponent: RouteErrorState,
  component: SystemPage,
});

/** The page with its settings hub: one card per topic that has its own screen. */
function SystemLayout({ children }: Readonly<{ children: ReactNode }>) {
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
      {children}
    </Page>
  );
}

function SystemPendingPage() {
  return (
    <SystemLayout>
      <Skeleton className="h-64 w-full" aria-hidden="true" />
      <Skeleton className="h-40 w-full" aria-hidden="true" />
    </SystemLayout>
  );
}

/**
 * Admin → System (#36): the settings hub, then the read-only configuration: the enabled
 * identity providers with their URLs and role settings, and the running build. Never a secret.
 */
function SystemPage() {
  const { data } = useSuspenseQuery(systemConfigurationQueryOptions());
  return (
    <SystemLayout>
      <section aria-labelledby="system-providers" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="system-providers" className="text-lg font-semibold">
            {m.admin_system_providers_heading()}
          </h2>
          <p className="text-muted-foreground">{m.admin_system_providers_description()}</p>
        </div>
        <SystemProviders providers={data.providers} />
      </section>
      <section aria-labelledby="system-build" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="system-build" className="text-lg font-semibold">
            {m.admin_system_build_heading()}
          </h2>
          <p className="text-muted-foreground">{m.admin_system_build_description()}</p>
        </div>
        <SystemBuild build={data.build} />
      </section>
    </SystemLayout>
  );
}
