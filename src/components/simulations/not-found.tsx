// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { SearchXIcon } from "lucide-react";
import { StatusPage } from "@/components/shell/route-error";
import { BackToSimulations } from "@/components/simulations/simulation-actions";
import { m } from "@/i18n/messages";

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
