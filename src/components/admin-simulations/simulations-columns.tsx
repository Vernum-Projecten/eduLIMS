// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Link } from "@tanstack/react-router";
import { NoActiveTeacherBadge } from "@/components/admin-simulations/no-active-teacher";
import { createDataTableColumnHelper } from "@/components/data-table/features";
import { m } from "@/i18n/messages";
import { formatDate, formatNumber } from "@/lib/i18n/format";
import type { AdminSimulation } from "@/server/simulations/admin-queries";

const helper = createDataTableColumnHelper<AdminSimulation>();

/** Returns the number of students over every lab of a simulation. */
function memberCount(simulation: AdminSimulation): number {
  return simulation.labs.reduce((sum, lab) => sum + lab.members, 0);
}

/**
 * The columns of the administrator's list of simulations (B5, #291). The order is fixed on the
 * server, so no column sorts; the name links to the read-only detail page.
 */
export const adminSimulationsColumns = helper.columns([
  helper.accessor("name", {
    id: "name",
    meta: { label: () => m.simulations_col_name() },
    enableHiding: false,
    enableSorting: false,
    header: () => m.simulations_col_name(),
    cell: ({ row }) => (
      <div className="flex min-w-40 flex-col items-start gap-1">
        <Link
          to="/admin/simulations/$simulationId"
          params={{ simulationId: row.original.id }}
          className="font-medium underline-offset-4 hover:underline"
        >
          {row.original.name}
        </Link>
        {!row.original.hasActiveTeacher && <NoActiveTeacherBadge />}
      </div>
    ),
  }),
  helper.accessor("teachers", {
    id: "teachers",
    meta: { label: () => m.simulations_col_teachers() },
    enableSorting: false,
    enableColumnFilter: false,
    header: () => m.simulations_col_teachers(),
    cell: ({ row }) =>
      row.original.teachers.length > 0 ? (
        <span className="block min-w-32 whitespace-normal">{row.original.teachers.join(", ")}</span>
      ) : (
        <span className="text-muted-foreground">{m.admin_simulations_teachers_none()}</span>
      ),
  }),
  helper.accessor((row) => row.labs.length, {
    id: "labs",
    meta: { label: () => m.simulations_col_labs() },
    enableSorting: false,
    enableColumnFilter: false,
    header: () => m.simulations_col_labs(),
    cell: ({ row }) => (
      <span className="tabular-nums">{formatNumber(row.original.labs.length)}</span>
    ),
  }),
  helper.accessor((row) => memberCount(row), {
    id: "members",
    meta: { label: () => m.simulations_col_members() },
    enableSorting: false,
    enableColumnFilter: false,
    header: () => m.simulations_col_members(),
    cell: ({ row }) => (
      <span className="tabular-nums">{formatNumber(memberCount(row.original))}</span>
    ),
  }),
  helper.accessor("createdAt", {
    id: "createdAt",
    meta: { label: () => m.simulations_col_created() },
    enableSorting: false,
    enableColumnFilter: false,
    header: () => m.simulations_col_created(),
    cell: ({ row }) => (
      <time dateTime={row.original.createdAt} className="whitespace-nowrap">
        {formatDate(row.original.createdAt)}
      </time>
    ),
  }),
]);
