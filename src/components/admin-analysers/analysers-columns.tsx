// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import {
  AnalyserRouteText,
  AnalyserStatusBadge,
} from "@/components/admin-analysers/analyser-badges";
import { AnalyserRowActions } from "@/components/admin-analysers/analyser-row-actions";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { createDataTableColumnHelper } from "@/components/data-table/features";
import { m } from "@/i18n/messages";
import { formatDateTime } from "@/lib/i18n/format";
import type { AnalyserRow } from "@/server/analysers/queries";

const helper = createDataTableColumnHelper<AnalyserRow>();

/** The columns of the analyser register (B3, #35); each owns its header and cell. */
export const analysersColumns = helper.columns([
  helper.accessor("model", {
    id: "model",
    meta: { label: () => m.admin_analysers_col_model() },
    enableHiding: false,
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    cell: ({ row }) => (
      <div className="flex min-w-40 flex-col">
        <span className="font-medium">{row.original.model}</span>
        {row.original.notes && (
          <span className="line-clamp-2 max-w-72 whitespace-normal text-muted-foreground">
            {row.original.notes}
          </span>
        )}
      </div>
    ),
  }),
  helper.accessor("serialNumber", {
    id: "serialNumber",
    meta: { label: () => m.admin_analysers_col_serial() },
    enableColumnFilter: false,
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    cell: ({ row }) => <span className="font-mono">{row.original.serialNumber}</span>,
  }),
  helper.accessor("location", {
    id: "location",
    meta: { label: () => m.admin_analysers_col_location() },
    enableColumnFilter: false,
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    cell: ({ row }) => row.original.location,
  }),
  helper.accessor("route", {
    id: "route",
    meta: { label: () => m.admin_analysers_col_route() },
    enableSorting: false,
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    cell: ({ row }) => <AnalyserRouteText route={row.original.route} />,
  }),
  helper.accessor("status", {
    id: "status",
    meta: { label: () => m.admin_analysers_col_status() },
    enableSorting: false,
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    cell: ({ row }) => <AnalyserStatusBadge status={row.original.status} />,
  }),
  helper.accessor("updatedAt", {
    id: "updatedAt",
    meta: { label: () => m.admin_analysers_col_updated() },
    enableColumnFilter: false,
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    cell: ({ row }) => (
      <time dateTime={row.original.updatedAt} className="whitespace-nowrap">
        {formatDateTime(row.original.updatedAt)}
      </time>
    ),
  }),
  helper.display({
    id: "actions",
    enableHiding: false,
    meta: { label: () => m.data_table_actions(), className: "w-12" },
    header: () => <span className="sr-only">{m.data_table_actions()}</span>,
    cell: ({ row }) => <AnalyserRowActions analyser={row.original} />,
  }),
]);
