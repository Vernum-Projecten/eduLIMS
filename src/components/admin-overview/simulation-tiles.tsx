// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Link } from "@tanstack/react-router";
import { FlaskConicalIcon } from "lucide-react";
import { COVER_LINK, Tile } from "@/components/admin-overview/account-tiles";
import { m } from "@/i18n/messages";

/** The overview's simulation tile (B5, #291): the number of simulations, linking to the list. */
export function SimulationTiles({ count }: Readonly<{ count: number }>) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      <li className="flex min-w-0">
        <Tile
          icon={FlaskConicalIcon}
          label={m.admin_overview_simulations()}
          value={count}
          link={
            <Link to="/admin/simulations" className={COVER_LINK}>
              {m.admin_overview_simulations()}
            </Link>
          }
        />
      </li>
    </ul>
  );
}
