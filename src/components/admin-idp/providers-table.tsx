// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Link } from "@tanstack/react-router";
import { useTable } from "@tanstack/react-table";
import { CircleCheckIcon, CircleOffIcon } from "lucide-react";
import type { ReactNode } from "react";
import { protocolLabel } from "@/components/admin-idp/idp-labels";
import { DataTable } from "@/components/data-table/data-table";
import { createDataTableColumnHelper, dataTableFeatures } from "@/components/data-table/features";
import { Badge } from "@/components/ui/badge";
import { m } from "@/i18n/messages";
import { formatNumber } from "@/lib/i18n/format";
import type { ProviderListRow } from "@/server/idp/queries";

/** The status of a provider as a badge with an icon and its text (WCAG 1.4.1). */
export function ProviderStatusBadge({ enabled }: Readonly<{ enabled: boolean }>) {
  const Icon = enabled ? CircleCheckIcon : CircleOffIcon;
  return (
    <Badge variant={enabled ? "secondary" : "outline"}>
      <Icon aria-hidden="true" data-icon="inline-start" />
      {enabled ? m.idp_status_enabled() : m.idp_status_disabled()}
    </Badge>
  );
}

const helper = createDataTableColumnHelper<ProviderListRow>();

const columns = helper.columns([
  helper.accessor("label", {
    id: "provider",
    meta: { label: () => m.idp_col_provider() },
    enableSorting: false,
    header: () => m.idp_col_provider(),
    cell: ({ row }) => (
      <div className="flex flex-col">
        <Link
          to="/admin/system/identity-providers/$providerId"
          params={{ providerId: row.original.providerId }}
          className="font-medium underline-offset-4 hover:underline"
        >
          {row.original.label}
        </Link>
        <span className="font-mono text-xs text-muted-foreground">{row.original.providerId}</span>
      </div>
    ),
  }),
  helper.accessor("protocol", {
    id: "protocol",
    meta: { label: () => m.idp_col_protocol() },
    enableSorting: false,
    header: () => m.idp_col_protocol(),
    cell: ({ row }) => protocolLabel(row.original.protocol),
  }),
  helper.accessor("enabled", {
    id: "status",
    meta: { label: () => m.idp_col_status() },
    enableSorting: false,
    header: () => m.idp_col_status(),
    cell: ({ row }) => <ProviderStatusBadge enabled={row.original.enabled} />,
  }),
  helper.accessor("domains", {
    id: "domains",
    meta: { label: () => m.idp_col_domains() },
    enableSorting: false,
    header: () => m.idp_col_domains(),
    cell: ({ row }) =>
      row.original.domains.length === 0 ? (
        <span className="text-muted-foreground">{m.idp_domains_none()}</span>
      ) : (
        <ul>
          {row.original.domains.map((domain) => (
            <li key={domain}>{domain}</li>
          ))}
        </ul>
      ),
  }),
  helper.accessor("accounts", {
    id: "accounts",
    meta: { label: () => m.idp_col_accounts(), className: "text-right tabular-nums" },
    enableSorting: false,
    header: () => m.idp_col_accounts(),
    cell: ({ row }) => formatNumber(row.original.accounts),
  }),
]);

/**
 * The identity providers in sign-in page order, each linking to its edit page, on the shared
 * data table (#58). There are few providers, so the server returns them all on one page.
 */
export function ProvidersTable({
  rows,
  empty,
}: Readonly<{ rows: readonly ProviderListRow[]; empty: ReactNode }>) {
  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: [...rows],
    rowCount: rows.length,
    getRowId: (row) => row.providerId,
    manualSorting: true,
    manualFiltering: true,
    manualPagination: true,
    enableRowSelection: false,
  });
  return <DataTable table={table} caption={m.idp_table_caption()} empty={empty} />;
}
