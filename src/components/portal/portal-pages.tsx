// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, HourglassIcon } from "lucide-react";
import { Page } from "@/components/shell/page-header";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { m } from "@/i18n/messages";
import type { NavItem, PortalNavigation } from "@/lib/navigation";

/** The `head()` title of a portal page: the page, its portal, then the product. */
export function portalPageTitle(portal: PortalNavigation, page: NavItem): string {
  return page === portal.overview
    ? `${portal.label()} | eduLIMS`
    : `${page.label()} | ${portal.label()} | eduLIMS`;
}

/**
 * A portal's overview: a welcome with the user's name and one card per section. It shows no
 * data, because the features are still to be built.
 */
export function PortalOverview({
  portal,
  userName,
}: Readonly<{ portal: PortalNavigation; userName: string }>) {
  return (
    <Page
      title={portal.label()}
      description={
        <>
          <p className="text-foreground">{m.welcome({ name: userName })}</p>
          <p>{portal.overview.description()}</p>
        </>
      }
    >
      <section aria-labelledby="overview-sections" className="flex flex-col gap-4">
        <h2 id="overview-sections" className="text-lg font-semibold">
          {m.overview_sections()}
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {portal.sections.map((section) => (
            <li key={section.to} className="flex">
              <SectionCard section={section} />
            </li>
          ))}
        </ul>
      </section>
    </Page>
  );
}

function SectionCard({ section }: Readonly<{ section: NavItem }>) {
  const Icon = section.icon;
  return (
    <Card className="relative w-full transition-colors focus-within:ring-3 focus-within:ring-ring/50 hover:bg-accent/50">
      <CardHeader>
        <span className="mb-2 flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon aria-hidden="true" className="size-5" />
        </span>
        <CardTitle>
          <h3>
            {/* The link covers the card, so the whole card is one target with one name. */}
            <Link
              to={section.to}
              className="outline-none after:absolute after:inset-0 after:rounded-xl"
            >
              {section.label()}
            </Link>
          </h3>
        </CardTitle>
        <CardDescription>{section.description()}</CardDescription>
        <CardAction>
          <ArrowRightIcon aria-hidden="true" className="size-4 text-muted-foreground" />
        </CardAction>
      </CardHeader>
    </Card>
  );
}

/** A section that is not built yet: its heading and purpose, and a "coming soon" state. */
export function SectionPlaceholder({ section }: Readonly<{ section: NavItem }>) {
  const Icon = section.icon;
  return (
    <Page title={section.label()} description={<p>{section.description()}</p>}>
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Icon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>
            <h2 className="flex items-center gap-2">
              <HourglassIcon aria-hidden="true" className="size-4" />
              {m.coming_soon_title()}
            </h2>
          </EmptyTitle>
          <EmptyDescription>{m.coming_soon_body()}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </Page>
  );
}
