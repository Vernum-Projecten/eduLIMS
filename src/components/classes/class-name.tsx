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
 * text. Screen readers read one sentence in place of the parts ("LS-2A, academic year
 * 2026–2027"), so element boundaries never add a stray space.
 */
export function ClassName({
  name,
  academicYear,
  archived = false,
  className,
}: Readonly<{ name: string; academicYear: string; archived?: boolean; className?: string }>) {
  const values = { name, year: displayYear(academicYear) };
  return (
    <span className={cn("inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1", className)}>
      <span className="sr-only">
        {archived ? m.classes_accessible_name_archived(values) : m.classes_accessible_name(values)}
      </span>
      <span aria-hidden="true" className="min-w-0 break-words">
        {name}
      </span>
      <Badge aria-hidden="true" variant="secondary" className="font-normal">
        {values.year}
      </Badge>
      {archived && (
        <Badge aria-hidden="true" variant="outline" className="font-normal">
          <ArchiveIcon data-icon="inline-start" />
          {m.classes_archived()}
        </Badge>
      )}
    </span>
  );
}
