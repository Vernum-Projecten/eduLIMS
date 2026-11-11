// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import {
  ArchiveIcon,
  CircleCheckIcon,
  FileSpreadsheetIcon,
  type LucideIcon,
  NetworkIcon,
  WrenchIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { AnalyserRoute, AnalyserStatus } from "@/lib/analysers";
import { analyserRouteLabel, analyserStatusLabel } from "@/lib/i18n/analyser-labels";

/** The icon of each analyser status, beside its text (WCAG 1.4.1). */
export const ANALYSER_STATUS_ICONS: Record<AnalyserStatus, LucideIcon> = {
  in_use: CircleCheckIcon,
  maintenance: WrenchIcon,
  retired: ArchiveIcon,
};

/** The icon of each route to FerroEHR, beside its text. */
export const ANALYSER_ROUTE_ICONS: Record<AnalyserRoute, LucideIcon> = {
  hl7_ferrobridge: NetworkIcon,
  excel_upload: FileSpreadsheetIcon,
};

/** An analyser's status as a badge with an icon and text (WCAG 1.4.1). */
export function AnalyserStatusBadge({ status }: Readonly<{ status: AnalyserStatus }>) {
  const Icon = ANALYSER_STATUS_ICONS[status];
  return (
    <Badge variant={status === "in_use" ? "outline" : "secondary"}>
      <Icon aria-hidden="true" data-icon="inline-start" />
      {analyserStatusLabel(status)}
    </Badge>
  );
}

/** An analyser's route as text with its icon. */
export function AnalyserRouteText({ route }: Readonly<{ route: AnalyserRoute }>) {
  const Icon = ANALYSER_ROUTE_ICONS[route];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
      {analyserRouteLabel(route)}
    </span>
  );
}
