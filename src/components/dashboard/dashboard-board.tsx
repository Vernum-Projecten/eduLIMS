// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { LabLogo } from "@/components/simulations/lab-logo";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { m } from "@/i18n/messages";
import type { AccuracyStatus, BoardSort } from "@/lib/dashboard";
import { orderBoard } from "@/lib/dashboard";
import type { BoardCell, BoardColumn, BoardLab } from "@/lib/dashboard-board";
import {
  accuracyStatusLabel,
  cellLabel,
  formatDuration,
  pendingText,
  valueWithUnit,
} from "@/lib/i18n/dashboard-labels";
import { formatDecimal, formatNumber } from "@/lib/i18n/format";
import { labLogoSrc } from "@/lib/lab-logo";
import { cn } from "@/lib/utils";
import { cellLook, STATUS_MARK } from "./accuracy-mark";

// NOTE: owner 2026-11-20 on #271; the lab and its summary stay in view while the cells scroll.
// Below `xl` only the position and the lab stay, so a narrow screen keeps room for the cells.
const STICKY = "sticky z-10 bg-background";
const SUMMARY = [
  { id: "green", width: "w-16 min-w-16", left: "xl:left-[15rem]" },
  { id: "yellow", width: "w-16 min-w-16", left: "xl:left-[19rem]" },
  { id: "red", width: "w-16 min-w-16", left: "xl:left-[23rem]" },
  { id: "released", width: "w-24 min-w-24", left: "xl:left-[27rem]" },
  { id: "median", width: "w-28 min-w-28", left: "xl:left-[33rem]" },
] as const;
type SummaryId = (typeof SUMMARY)[number]["id"];
const STATUSES: readonly AccuracyStatus[] = ["green", "yellow", "red"];

function summaryHeader(id: SummaryId): string {
  switch (id) {
    case "green":
      return m.dashboard_col_green();
    case "yellow":
      return m.dashboard_col_yellow();
    case "red":
      return m.dashboard_col_red();
    case "released":
      return m.dashboard_col_released();
    case "median":
      return m.dashboard_col_median();
    default: {
      const unknown: never = id;
      return unknown;
    }
  }
}

function summaryText(id: SummaryId, summary: BoardLab["summary"]): string {
  switch (id) {
    case "green":
    case "yellow":
    case "red":
      return formatNumber(summary[id]);
    case "released":
      return m.dashboard_released_of({
        released: formatNumber(summary.released),
        requested: formatNumber(summary.requested),
      });
    case "median":
      return summary.medianTurnaroundMs === null ? "—" : formatDuration(summary.medianTurnaroundMs);
    default: {
      const unknown: never = id;
      return unknown;
    }
  }
}

function Detail({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="flex justify-between gap-4">
      <dt>{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

/** One cell of the board: its value or state as text with an icon, and the details on focus. */
function Cell({
  lab,
  column,
  cell,
  readAt,
}: Readonly<{ lab: string; column: BoardColumn; cell: BoardCell | undefined; readAt: string }>) {
  const look = cellLook(cell);
  const Icon = look.icon;
  const label = cellLabel(lab, column, cell, readAt);
  let text: string = m.dashboard_state_not_requested();
  if (cell?.state === "released") text = formatDecimal(cell.value);
  else if (cell !== undefined) text = pendingText(cell, readAt);
  const button = (
    <button
      type="button"
      aria-label={label}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        look.className,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="truncate tabular-nums">{text}</span>
    </button>
  );
  if (cell === undefined) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="top" className="block">
        <dl className="flex min-w-48 flex-col gap-1">
          <Detail
            label={m.dashboard_detail_correct()}
            value={valueWithUnit(column.correctValue, column)}
          />
          {cell.state === "released" ? (
            <>
              <Detail
                label={m.dashboard_detail_value()}
                value={valueWithUnit(cell.value, column)}
              />
              <Detail
                label={m.dashboard_detail_turnaround()}
                value={formatDuration(cell.turnaroundMs)}
              />
              <Detail
                label={m.dashboard_detail_status()}
                value={accuracyStatusLabel(cell.status)}
              />
            </>
          ) : (
            <Detail
              label={m.dashboard_detail_open()}
              value={formatDuration(Date.parse(readAt) - Date.parse(cell.enteredAt))}
            />
          )}
          {cell.notOffered !== null && (
            <Detail
              label={m.dashboard_detail_not_offered()}
              value={
                cell.notOffered.length === 0
                  ? m.dashboard_detail_none()
                  : cell.notOffered.join(", ")
              }
            />
          )}
        </dl>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The board of the running simulation (D11, G-01, G-03; owner 2026-11-20 on #271): a row per
 * lab with its position, its summary and a cell per sample and test of the answer model. A real
 * table with row and column headers, in a named region that scrolls and takes keyboard focus
 * (WCAG 1.3.1, 2.1.1, 1.4.10). Every value comes from the server's read; the order is the one
 * tested rule {@link orderBoard}.
 */
export function DashboardBoard({
  name,
  columns,
  labs,
  readAt,
  sort,
}: Readonly<{
  name: string;
  columns: readonly BoardColumn[];
  labs: readonly BoardLab[];
  readAt: string;
  sort: BoardSort;
}>) {
  const rows = orderBoard(
    labs.map((lab) => ({
      ...lab,
      green: lab.summary.green,
      red: lab.summary.red,
      medianTurnaroundMs: lab.summary.medianTurnaroundMs,
    })),
    sort,
  );
  const notOffered = labs.some((lab) => lab.notOffered !== null);
  return (
    <section
      aria-label={m.dashboard_board_label({ name })}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard (WCAG 2.1.1).
      tabIndex={0}
      className="relative max-h-[70svh] overflow-auto rounded-lg border outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&>[data-slot=table-container]]:overflow-visible"
    >
      <Table>
        <TableCaption className="sr-only">{m.dashboard_board_caption()}</TableCaption>
        <TableHeader className="sticky top-0 z-20 bg-background shadow-[inset_0_-1px_0_var(--color-border)]">
          <TableRow className="hover:bg-transparent">
            <TableHead scope="col" className={cn(STICKY, "left-0 w-12 min-w-12")}>
              <span className="sr-only">{m.dashboard_col_position()}</span>
              <span aria-hidden="true">#</span>
            </TableHead>
            <TableHead scope="col" className={cn(STICKY, "left-12 w-48 min-w-48")}>
              {m.dashboard_col_lab()}
            </TableHead>
            {SUMMARY.map((column) => {
              const status = STATUSES.find((s) => s === column.id);
              const Icon = status ? STATUS_MARK[status].icon : null;
              return (
                <TableHead
                  key={column.id}
                  scope="col"
                  className={cn(column.width, "bg-background xl:sticky xl:z-10", column.left)}
                >
                  <span className="inline-flex items-center gap-1">
                    {Icon && status && (
                      <Icon
                        aria-hidden="true"
                        className={cn("size-3.5", STATUS_MARK[status].text)}
                      />
                    )}
                    {summaryHeader(column.id)}
                  </span>
                </TableHead>
              );
            })}
            {notOffered && (
              <TableHead scope="col" className="w-24 min-w-24">
                {m.dashboard_col_not_offered()}
              </TableHead>
            )}
            {columns.map((column) => (
              <TableHead key={column.key} scope="col" className="h-auto min-w-32 py-2 align-bottom">
                <span className="flex flex-col whitespace-normal">
                  <span className="font-semibold">{column.sampleNumber}</span>
                  <span className="font-normal text-muted-foreground">{column.testName}</span>
                </span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((lab) => {
            const cells = new Map(lab.cells.map((cell) => [cell.key, cell]));
            return (
              <TableRow key={lab.labId} className="hover:bg-transparent">
                <TableCell className={cn(STICKY, "left-0 font-semibold tabular-nums")}>
                  <span className="sr-only">
                    {m.dashboard_position({ position: String(lab.position) })}
                  </span>
                  <span aria-hidden="true">{formatNumber(lab.position)}</span>
                </TableCell>
                <TableHead scope="row" className={cn(STICKY, "left-12 font-medium")}>
                  <span className="flex items-center gap-2">
                    <LabLogo
                      src={lab.logoVersion === null ? null : labLogoSrc(lab.labId, lab.logoVersion)}
                      alt=""
                      size="sm"
                    />
                    <span className="truncate">{lab.name}</span>
                  </span>
                </TableHead>
                {SUMMARY.map((column) => (
                  <TableCell
                    key={column.id}
                    className={cn("bg-background tabular-nums xl:sticky xl:z-10", column.left)}
                  >
                    {summaryText(column.id, lab.summary)}
                  </TableCell>
                ))}
                {notOffered && (
                  <TableCell className="tabular-nums">
                    {lab.notOffered === null ? "—" : formatNumber(lab.notOffered)}
                  </TableCell>
                )}
                {columns.map((column) => (
                  <TableCell key={column.key} className="p-1">
                    <Cell
                      lab={lab.name}
                      column={column}
                      cell={cells.get(column.key)}
                      readAt={readAt}
                    />
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}
