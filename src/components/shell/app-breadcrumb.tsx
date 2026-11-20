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
import { breadcrumbFor } from "@/lib/navigation";

/** One step of the trail below a section: the name a route's loader returned, and its address. */
interface Crumb {
  label: string;
  to: string;
}

/** Returns the `crumb` a route's loader returned (the page's own name), if it returned one. */
function crumbOf(loaderData: unknown): string | null {
  if (typeof loaderData !== "object" || loaderData === null) return null;
  const crumb: unknown = Reflect.get(loaderData, "crumb");
  return typeof crumb === "string" && crumb !== "" ? crumb : null;
}

/**
 * Returns the trail of the matched routes that name themselves, outermost first, as JSON: a
 * string keeps the router's selector result stable between renders. A layout and its index
 * page that name the same thing show once.
 */
function trailOf(matches: readonly { loaderData?: unknown; pathname: string }[]): string {
  const trail: Crumb[] = [];
  for (const match of matches) {
    const label = crumbOf(match.loaderData);
    if (label !== null && trail.at(-1)?.label !== label) {
      trail.push({ label, to: match.pathname });
    }
  }
  return JSON.stringify(trail);
}

function parseTrail(json: string): Crumb[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item: unknown) => {
    if (typeof item !== "object" || item === null) return [];
    const label: unknown = Reflect.get(item, "label");
    const to: unknown = Reflect.get(item, "to");
    return typeof label === "string" && typeof to === "string" ? [{ label, to }] : [];
  });
}

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
