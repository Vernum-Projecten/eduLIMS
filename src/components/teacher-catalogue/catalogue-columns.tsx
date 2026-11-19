// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { createDataTableColumnHelper } from "@/components/data-table/features";
import { TestSourceText, TestStatusBadge } from "@/components/teacher-catalogue/catalogue-badges";
import { TestRowActions } from "@/components/teacher-catalogue/test-row-actions";
import { m } from "@/i18n/messages";
import { formatDateTime } from "@/lib/i18n/format";
import type { CatalogueTestRow } from "@/server/catalogue/queries";

const helper = createDataTableColumnHelper<CatalogueTestRow>();

/** The columns of the test catalogue (D9, #266); each owns its header and cell. */
export const catalogueColumns = helper.columns([
  helper.accessor("name", {
    id: "name",
    meta: { label: () => m.catalogue_col_name() },
    enableHiding: false,
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  }),
  helper.accessor("unit", {
    id: "unit",
    meta: { label: () => m.catalogue_col_unit() },
    enableColumnFilter: false,
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    cell: ({ row }) =>
      row.original.unit ?? <span className="text-muted-foreground">{m.catalogue_no_unit()}</span>,
  }),
  helper.accessor("material", {
    id: "material",
    meta: { label: () => m.catalogue_col_material() },
    enableColumnFilter: false,
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    cell: ({ row }) => row.original.material,
  }),
  helper.accessor((row) => row.source.kind, {
    id: "source",
    meta: { label: () => m.catalogue_col_source() },
    enableSorting: false,
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    cell: ({ row }) => <TestSourceText source={row.original.source} />,
  }),
  helper.accessor("status", {
    id: "status",
    meta: { label: () => m.catalogue_col_status() },
    enableSorting: false,
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    cell: ({ row }) => <TestStatusBadge status={row.original.status} />,
  }),
  helper.accessor("updatedAt", {
    id: "updatedAt",
    meta: { label: () => m.catalogue_col_updated() },
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
    cell: ({ row }) => <TestRowActions test={row.original} />,
  }),
]);
