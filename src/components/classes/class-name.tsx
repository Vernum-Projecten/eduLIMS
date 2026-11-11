// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { ArchiveIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { m } from "@/i18n/messages";
import { cn } from "@/lib/utils";

/** Returns an academic year as people write it: "2026-2027" becomes "2026–2027". */
export function displayYear(academicYear: string): string {
  return academicYear.replace("-", "–");
}

/**
 * Returns a class as plain text, for a page title or a select option: the name, the academic
 * year and, when archived, "Archived" ("LS-2A 2026–2027").
 */
export function classLabel(
  value: Readonly<{ name: string; academicYear: string; archivedAt?: string | null }>,
): string {
  const text = m.classes_label({ name: value.name, year: displayYear(value.academicYear) });
  return value.archivedAt ? m.classes_label_archived({ label: text }) : text;
}

/**
 * A class name everywhere it appears (#28, owner decision): the name, then the academic year as
 * a `secondary` badge and, for an archived class, an "Archived" `outline` badge with an icon and
 * text. Screen readers read the badges as part of the name ("LS-2A, academic year 2026–2027").
 */
export function ClassName({
  name,
  academicYear,
  archived = false,
  className,
}: Readonly<{ name: string; academicYear: string; archived?: boolean; className?: string }>) {
  return (
    <span className={cn("inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1", className)}>
      <span className="min-w-0 break-words">
        {name}
        <span className="sr-only">{m.classes_year_prefix()}</span>
      </span>
      <Badge variant="secondary" className="font-normal">
        {displayYear(academicYear)}
      </Badge>
      {archived && (
        <Badge variant="outline" className="font-normal">
          <ArchiveIcon aria-hidden="true" data-icon="inline-start" />
          {m.classes_archived()}
        </Badge>
      )}
    </span>
  );
}
