// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Link, useLocation, useMatches } from "@tanstack/react-router";
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

/** Returns the `crumb` a route's loader returned (the class name), if it returned one. */
function crumbOf(loaderData: unknown): string | null {
  if (typeof loaderData !== "object" || loaderData === null) return null;
  const crumb: unknown = Reflect.get(loaderData, "crumb");
  return typeof crumb === "string" && crumb !== "" ? crumb : null;
}

/**
 * The breadcrumb of the current page in the top bar: its portal, then the page. A page below a
 * section (a class page) shows the section as a link and then its own name, which its loader
 * returns as `crumb`.
 */
export function AppBreadcrumb() {
  const crumb = useLocation({ select: (location) => breadcrumbFor(location.pathname) });
  const detail = useMatches({
    select: (matches) => crumbOf(matches.at(-1)?.loaderData),
  });
  if (!crumb) return null;
  const nested = crumb.nested && detail !== null;

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
            <BreadcrumbSeparator />
            <BreadcrumbItem className="min-w-0">
              <BreadcrumbPage className="truncate">{detail}</BreadcrumbPage>
            </BreadcrumbItem>
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
