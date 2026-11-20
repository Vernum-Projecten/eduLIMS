// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Link, useLocation, useMatches } from "@tanstack/react-router";
import { Fragment, useMemo } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { m } from "@/i18n/messages";
import { parseTrail, trailOf } from "@/lib/breadcrumb-trail";
import { breadcrumbFor } from "@/lib/navigation";

/**
 * The breadcrumb of the current page in the top bar, the first line of every page's frame: its
 * portal, its section, then each nested page that names itself through its loader's `crumb`
 * (a simulation, one of its pages, a lab). Every step but the last is a link.
 */
export function AppBreadcrumb() {
  const crumb = useLocation({ select: (location) => breadcrumbFor(location.pathname) });
  const json = useMatches({ select: trailOf });
  const trail = useMemo(() => parseTrail(json), [json]);
  if (!crumb) return null;
  const nested = crumb.nested && trail.length > 0;

  return (
    <Breadcrumb aria-label={m.breadcrumb_label()} className="min-w-0">
      <BreadcrumbList className="flex-nowrap">
        <BreadcrumbItem className="min-w-0">
          <BreadcrumbLink asChild>
            <Link to={crumb.portal.overview.to} className="truncate">
              {crumb.portal.label()}
            </Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        {nested ? (
          <>
            <BreadcrumbItem className="min-w-0">
              <BreadcrumbLink asChild>
                <Link to={crumb.page.to} className="truncate">
                  {crumb.page.label()}
                </Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            {trail.map((step, index) => (
              <Fragment key={step.to}>
                <BreadcrumbSeparator />
                <BreadcrumbItem className="min-w-0">
                  {index === trail.length - 1 ? (
                    <BreadcrumbPage className="truncate">{step.label}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link to={step.to} className="truncate">
                        {step.label}
                      </Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </Fragment>
            ))}
          </>
        ) : (
          <BreadcrumbItem className="min-w-0">
            <BreadcrumbPage className="truncate">{crumb.page.label()}</BreadcrumbPage>
          </BreadcrumbItem>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
