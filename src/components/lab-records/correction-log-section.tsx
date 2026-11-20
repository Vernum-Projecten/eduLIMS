// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { HistoryIcon } from "lucide-react";
import { UpdatingIndicator } from "@/components/shell/updating-indicator";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { m } from "@/i18n/messages";
import { formatDateTime } from "@/lib/i18n/format";
import { correctionFieldLabel } from "@/lib/i18n/records-labels";
import { formatLabNumber } from "@/lib/lab-number";
import type { CorrectionLog } from "@/server/lab-records/correction-log";
import type { CorrectionChange } from "@/server/lab-records/corrections";
import { correctionLogQueryOptions } from "@/server/lab-records/query-options";

const HEADING = "correction-log-heading";

/** Returns a stored value in words: a flag as yes or no, nothing as a dash. */
function valueText(value: string | boolean | null): string {
  if (value === null) return m.records_none();
  if (typeof value === "boolean") return value ? m.records_yes() : m.records_no();
  return value;
}

function testList(ids: readonly string[], names: CorrectionLog["testNames"]): string {
  return ids.map((id) => names[id] ?? m.records_unknown_test()).join(", ");
}

/** Returns one change as "before → after" text, so nothing depends on colour (WCAG 1.4.1). */
function changeText(change: CorrectionChange, names: CorrectionLog["testNames"]): string {
  switch (change.field) {
    case "tests":
      return m.records_change({
        before: testList(change.before, names),
        after: testList(change.after, names),
      });
    case "sample_added":
      return m.records_change_sample_added({
        sample: change.sample_number,
        material: change.material,
        number: formatLabNumber(change.lab_number),
      });
    case "sample_number":
    case "material":
      return m.records_change({ before: change.before, after: change.after });
    default:
      return m.records_change({
        before: valueText(change.before),
        after: valueText(change.after),
      });
  }
}

/**
 * The correction log of a simulation for its teachers (S11, S12): every correction a lab made
 * to a patient or a request, newest first, with the fields before and after and who made it.
 */
export function CorrectionLogSection({ simulationId }: Readonly<{ simulationId: string }>) {
  const { data: log, isFetching } = useSuspenseQuery(correctionLogQueryOptions(simulationId));
  return (
    <section aria-labelledby={HEADING} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id={HEADING} className="font-semibold text-lg">
          {m.records_log_heading()}
        </h2>
        <p className="text-muted-foreground text-sm">{m.records_log_body()}</p>
      </div>
      <div className="relative" aria-busy={isFetching}>
        <UpdatingIndicator active={isFetching} />
        {log.entries.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HistoryIcon aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>{m.records_log_empty_title()}</EmptyTitle>
              <EmptyDescription>{m.records_log_empty_body()}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableCaption className="sr-only">{m.records_log_heading()}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{m.records_log_when()}</TableHead>
                <TableHead scope="col">{m.records_log_lab()}</TableHead>
                <TableHead scope="col">{m.records_log_record()}</TableHead>
                <TableHead scope="col">{m.records_log_by()}</TableHead>
                <TableHead scope="col">{m.records_log_changes()}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {log.entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-normal">
                    {formatDateTime(entry.correctedAt)}
                  </TableCell>
                  <TableCell className="whitespace-normal break-words">{entry.labName}</TableCell>
                  <TableCell className="whitespace-normal break-words">
                    {entry.target.kind === "patient"
                      ? m.records_log_patient({ name: entry.target.name })
                      : m.records_log_request({
                          numbers: entry.target.labNumbers.map(formatLabNumber).join(", "),
                        })}
                  </TableCell>
                  <TableCell className="whitespace-normal break-words">
                    {entry.correctedBy ?? m.records_log_gone()}
                  </TableCell>
                  <TableCell className="whitespace-normal break-words">
                    <ul className="flex flex-col gap-1">
                      {entry.changes.map((change, index) => (
                        <li
                          // biome-ignore lint/suspicious/noArrayIndexKey: a stored change list never reorders.
                          key={index}
                          className="break-words"
                        >
                          <span className="font-medium">{correctionFieldLabel(change.field)}:</span>{" "}
                          {changeText(change, log.testNames)}
                        </li>
                      ))}
                    </ul>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {log.truncated ? (
          <p className="mt-2 text-muted-foreground text-sm">{m.records_log_truncated()}</p>
        ) : null}
      </div>
    </section>
  );
}
