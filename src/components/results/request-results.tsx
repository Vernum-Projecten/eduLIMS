// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { notOfferedText } from "@/components/lab-records/request-details-sheet";
import { Badge } from "@/components/ui/badge";
import { m } from "@/i18n/messages";
import { formatDateTime } from "@/lib/i18n/format";
import { requestKindLabel } from "@/lib/i18n/records-labels";
import { formatLabNumber } from "@/lib/lab-number";
import type { RequestedTestRow, ResultsRequestRow } from "@/server/results/queries";
import { RequestedTest, type RequestedTestActions } from "./requested-test";

/**
 * One request with its requested tests and their measurements (S14, S15, D11). The student's
 * screen passes `actions`; the teacher's view passes none and only reads.
 */
export function RequestResults({
  request,
  headingId,
  actions,
  notice = () => null,
}: Readonly<{
  request: ResultsRequestRow;
  headingId: (testId: string) => string;
  actions: ((test: RequestedTestRow) => RequestedTestActions) | null;
  /** A refusal to show at a requested test, after a dialog closed on it. */
  notice?: (testId: string) => string | null;
}>) {
  const title = request.patientName
    ? m.records_request_for({ name: request.patientName })
    : requestKindLabel(request.kind);
  const requestHeading = `results-request-${request.id}`;
  return (
    <li>
      <article
        aria-labelledby={requestHeading}
        className="flex flex-col gap-4 rounded-lg border p-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <h3 id={requestHeading} className="font-semibold break-words">
              {title}
            </h3>
            <p className="text-muted-foreground text-sm">
              {m.records_entered_label()}{" "}
              <time dateTime={request.enteredAt}>{formatDateTime(request.enteredAt)}</time>
            </p>
            <p className="text-muted-foreground text-sm break-words">
              {m.results_lab_numbers({
                numbers: request.samples
                  .map((sample) => formatLabNumber(sample.labNumber))
                  .join(", "),
              })}
            </p>
          </div>
          <Badge variant="outline">{requestKindLabel(request.kind)}</Badge>
        </div>
        {request.notOffered.length === 0 ? null : (
          <p className="text-sm break-words">
            {m.records_not_offered_list({
              tests: request.notOffered.map(notOfferedText).join(", "),
            })}
          </p>
        )}
        {request.tests.map((test) => (
          <RequestedTest
            key={test.testId}
            test={test}
            headingId={headingId(test.testId)}
            actions={actions ? actions(test) : null}
            notice={notice(test.testId)}
          />
        ))}
      </article>
    </li>
  );
}
