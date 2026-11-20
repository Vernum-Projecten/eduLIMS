// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import {
  ArchiveIcon,
  CircleCheckIcon,
  CirclePlayIcon,
  FileSpreadsheetIcon,
  KeyboardIcon,
  LockIcon,
  type LucideIcon,
  NetworkIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { TestSource, TestSourceKind, TestStatus, TestUsage } from "@/lib/catalogue";
import {
  testSourceDetail,
  testSourceLabel,
  testStatusLabel,
  testUsageLabel,
} from "@/lib/i18n/catalogue-labels";

/** The icon of each test status, beside its text (WCAG 1.4.1). */
export const TEST_STATUS_ICONS: Record<TestStatus, LucideIcon> = {
  active: CircleCheckIcon,
  retired: ArchiveIcon,
};

/** The icon of each source of measurements, beside its text. */
export const TEST_SOURCE_ICONS: Record<TestSourceKind, LucideIcon> = {
  afinion: NetworkIcon,
  epoch_upload: FileSpreadsheetIcon,
  manual: KeyboardIcon,
};

/** A test's status as a badge with an icon and text (WCAG 1.4.1). */
export function TestStatusBadge({ status }: Readonly<{ status: TestStatus }>) {
  const Icon = TEST_STATUS_ICONS[status];
  return (
    <Badge variant={status === "active" ? "outline" : "secondary"}>
      <Icon aria-hidden="true" data-icon="inline-start" />
      {testStatusLabel(status)}
    </Badge>
  );
}

/** The icon of each way simulations use a test, beside its text (WCAG 1.4.1). */
export const TEST_USAGE_ICONS: Record<Exclude<TestUsage, "unused">, LucideIcon> = {
  used: LockIcon,
  running: CirclePlayIcon,
};

/**
 * How simulations use a test, as an icon and text below its status (D9, #267), so an
 * administrator sees which settings are fixed before opening the edit dialog. An unused test
 * shows nothing.
 */
export function TestUsageText({ usage }: Readonly<{ usage: TestUsage }>) {
  const label = testUsageLabel(usage);
  if (usage === "unused" || label === null) return null;
  const Icon = TEST_USAGE_ICONS[usage];
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <Icon aria-hidden="true" className="size-4" />
      {label}
    </span>
  );
}

/** A test's source with its icon, and its setting (the analyte or the calculator) below it. */
export function TestSourceText({ source }: Readonly<{ source: TestSource }>) {
  const Icon = TEST_SOURCE_ICONS[source.kind];
  const detail = testSourceDetail(source);
  return (
    <div className="flex flex-col">
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
        {testSourceLabel(source.kind)}
      </span>
      {detail && <span className="text-muted-foreground">{detail}</span>}
    </div>
  );
}
