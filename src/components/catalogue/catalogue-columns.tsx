// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import {
  TestSourceText,
  TestStatusBadge,
  TestUsageText,
} from "@/components/catalogue/catalogue-badges";
import { TestRowActions } from "@/components/catalogue/test-row-actions";
import { ACTIONS_COLUMN, DateTimeCell } from "@/components/data-table/common-columns";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { createDataTableColumnHelper } from "@/components/data-table/features";
import { m } from "@/i18n/messages";
import { unitLabel } from "@/lib/i18n/unit-labels";
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
      row.original.unit === null ? (
        <span className="text-muted-foreground">{m.catalogue_no_unit()}</span>
      ) : (
        unitLabel(row.original.unit)
      ),
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
    cell: ({ row }) => (
      <div className="flex flex-col items-start gap-1">
        <TestStatusBadge status={row.original.status} />
        <TestUsageText usage={row.original.usage} />
      </div>
    ),
  }),
  helper.accessor("updatedAt", {
    id: "updatedAt",
    meta: { label: () => m.catalogue_col_updated() },
    enableColumnFilter: false,
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    cell: ({ row }) => <DateTimeCell value={row.original.updatedAt} />,
  }),
  helper.display({
    ...ACTIONS_COLUMN,
    cell: ({ row }) => <TestRowActions test={row.original} />,
  }),
]);
