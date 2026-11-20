// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { UpdatingIndicator } from "@/components/shell/updating-indicator";
import { m } from "@/i18n/messages";
import { labResultsQueryOptions } from "@/server/results/query-options";
import { RequestResults } from "./request-results";

const HEADING = "lab-results-heading";

/**
 * A lab's measurements and results for the teachers of its simulation (D11): per request every
 * requested test with each measurement, the released one marked with an icon and text, its time
 * of release and the team's tolerance kept at the release. Read-only.
 */
export function LabResultsSection({
  simulationId,
  labId,
}: Readonly<{ simulationId: string; labId: string }>) {
  const { data, isFetching } = useSuspenseQuery(labResultsQueryOptions(simulationId, labId));
  return (
    <section
      aria-labelledby={HEADING}
      className="relative flex flex-col gap-4"
      aria-busy={isFetching}
    >
      <UpdatingIndicator active={isFetching} />
      <div className="flex flex-col gap-1">
        <h2 id={HEADING} className="text-lg font-semibold">
          {m.results_teacher_heading()}
        </h2>
        <p className="text-muted-foreground">{m.results_teacher_description()}</p>
      </div>
      {data.requests.length === 0 ? (
        <p className="text-muted-foreground">{m.results_teacher_empty()}</p>
      ) : (
        <ol className="flex flex-col gap-4">
          {data.requests.map((request) => (
            <RequestResults
              key={request.id}
              request={request}
              headingId={(testId) => `lab-result-${request.id}-${testId}`}
              actions={null}
            />
          ))}
        </ol>
      )}
    </section>
  );
}
