// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Link, useLocation } from "@tanstack/react-router";
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

/** The breadcrumb of the current page in the top bar: its portal, then the page. */
export function AppBreadcrumb() {
  const crumb = useLocation({ select: (location) => breadcrumbFor(location.pathname) });
  if (!crumb) return null;

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
        <BreadcrumbItem className="min-w-0">
          <BreadcrumbPage className="truncate">{crumb.page.label()}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
