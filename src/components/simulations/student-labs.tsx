// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FlaskConicalIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { UpdatingIndicator } from "@/components/shell/updating-indicator";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { m } from "@/i18n/messages";
import { linkedMessage } from "@/lib/i18n/simulation-labels";
import { toast } from "@/lib/toast";
import { linkMyLabsFn } from "@/server/simulations/functions";
import { linkMyLabsMutationOptions, myLabsQueryOptions } from "@/server/simulations/query-options";

const HEADING = "my-labs-heading";

/**
 * Links the student's waiting addresses once, when the overview opens (S10): a student who was
 * signed in before a teacher added their address lands in the lab without a second sign-in. A
 * POST after hydration, never in the loader, which also runs on a preload. A new place is
 * announced in a toast (WCAG 4.1.3); a failure stays on screen until it is closed.
 */
function useLinkOnOpen(): void {
  const queryClient = useQueryClient();
  const call = useServerFn(linkMyLabsFn);
  const { mutate } = useMutation(linkMyLabsMutationOptions(queryClient, call));
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const { queryKey } = myLabsQueryOptions();
    const before = queryClient.getQueryData(queryKey) ?? [];
    mutate(undefined, {
      // Runs after the mutation's own `onSettled` has read the labs again, so `after` is fresh.
      onSuccess: (outcome) => {
        const after = queryClient.getQueryData(queryKey) ?? [];
        const message = linkedMessage(outcome.linked, before, after);
        if (message) toast.success(message);
      },
      onError: () => toast.error(m.student_labs_link_failed()),
    });
  }, [mutate, queryClient]);
}

/**
 * The labs the signed-in student is in, on the Student portal overview (S10): each lab's name
 * and its simulation, nothing of another lab. The media slot holds an icon until the lab logo
 * exists (#293).
 */
export function StudentLabs() {
  useLinkOnOpen();
  const { data: labs, isFetching } = useSuspenseQuery(myLabsQueryOptions());
  return (
    <section aria-labelledby={HEADING} className="flex flex-col gap-4">
      <h2 id={HEADING} className="text-lg font-semibold">
        {m.student_labs_heading()}
      </h2>
      <div className="relative" aria-busy={isFetching}>
        <UpdatingIndicator active={isFetching} />
        {labs.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FlaskConicalIcon aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>{m.student_labs_empty_title()}</EmptyTitle>
              <EmptyDescription>{m.student_labs_empty_body()}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul aria-labelledby={HEADING} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {labs.map((lab) => (
              <li key={lab.labId}>
                <Item variant="outline">
                  <ItemMedia variant="icon">
                    <FlaskConicalIcon aria-hidden="true" />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle className="break-words">{lab.labName}</ItemTitle>
                    <ItemDescription className="break-words">
                      {m.student_labs_simulation({ simulation: lab.simulationName })}
                    </ItemDescription>
                  </ItemContent>
                </Item>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
