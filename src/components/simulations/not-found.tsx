// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { SearchXIcon } from "lucide-react";
import { StatusPage } from "@/components/shell/route-error";
import { BackToSimulations } from "@/components/simulations/simulation-actions";
import { m } from "@/i18n/messages";
import { portalNavigation, sectionOf } from "@/lib/navigation";

/**
 * Returns the `head()` title of a simulation or lab page (WCAG 2.4.2): `found` when the loader
 * found the page, the not-found title when the route's match is `notFound`.
 */
export function simulationPageTitle(status: string, found: string): string {
  const page = status === "notFound" ? m.simulations_not_found_title() : found;
  return `${page} | ${sectionOf("teacher", "simulations").label()} | ${portalNavigation("teacher").label()} | eduLIMS`;
}

/**
 * The page of a simulation or a lab that does not exist or that the teacher does not teach: the
 * server answers both the same (D11), so the screen does too.
 */
export function SimulationNotFound() {
  return (
    <StatusPage
      icon={<SearchXIcon aria-hidden="true" />}
      title={m.simulations_not_found_title()}
      body={<span role="alert">{m.simulations_not_found_body()}</span>}
    >
      <BackToSimulations />
    </StatusPage>
  );
}
