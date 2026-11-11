// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { VirtualList } from "@/components/virtual/virtual-list";
import { m } from "@/i18n/messages";
import { formatNumber } from "@/lib/i18n/format";
import { type DemoRow, demoRows } from "@/lib/virtual-demo-rows";

/** Rows in the demo: the size issue #64 asks the virtualised list to handle. */
export const DEMO_ROW_COUNT = 10_000;

const ANALYTE_LABEL: Record<DemoRow["analyte"], () => string> = {
  hba1c: m.dev_virtual_analyte_hba1c,
  crp: m.dev_virtual_analyte_crp,
  absorbance: m.dev_virtual_analyte_absorbance,
};

const ANALYTE_UNIT: Record<DemoRow["analyte"], string> = {
  hba1c: "%",
  crp: "mg/L",
  absorbance: "OD",
};

function DemoRowView({ row }: Readonly<{ row: DemoRow }>) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono text-sm font-medium">{row.id}</span>
        <span className="text-sm text-muted-foreground">{ANALYTE_LABEL[row.analyte]()}</span>
        <span className="text-sm tabular-nums">
          {formatNumber(row.value)} {ANALYTE_UNIT[row.analyte]}
        </span>
        {row.inRange ? (
          <Badge variant="secondary">
            <CircleCheckIcon aria-hidden="true" data-icon="inline-start" />
            {m.dev_virtual_in_range()}
          </Badge>
        ) : (
          <Badge variant="outline">
            <CircleAlertIcon
              aria-hidden="true"
              data-icon="inline-start"
              className="text-destructive"
            />
            {m.dev_virtual_out_of_range()}
          </Badge>
        )}
      </div>
      {row.hasNote ? <p className="text-sm text-muted-foreground">{m.dev_virtual_note()}</p> : null}
    </div>
  );
}

/** The `/dev/virtual` page body: 10,000 deterministic fictional rows in a {@link VirtualList}. */
export function VirtualListDemo() {
  const rows = useMemo(() => demoRows(DEMO_ROW_COUNT), []);
  return (
    <section aria-labelledby="page-title" className="flex flex-col gap-4">
      <h1 id="page-title" className="text-2xl font-semibold tracking-tight">
        {m.dev_virtual_title()}
      </h1>
      <p className="max-w-prose text-muted-foreground">
        {m.dev_virtual_intro({ count: formatNumber(DEMO_ROW_COUNT) })}
      </p>
      <VirtualList
        items={rows}
        getKey={(row) => row.id}
        renderItem={(row) => <DemoRowView row={row} />}
        label={m.dev_virtual_list_label()}
        estimateRowHeight={52}
        initialViewportHeight={480}
        className="h-[480px] max-h-[60svh]"
      />
    </section>
  );
}
