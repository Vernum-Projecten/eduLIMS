// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FlaskConicalIcon, InfoIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { UpdatingIndicator } from "@/components/shell/updating-indicator";
import { LabLogo } from "@/components/simulations/lab-logo";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { labLogoSrc } from "@/lib/lab-logo";
import { toast } from "@/lib/toast";
import { linkMyLabsFn } from "@/server/simulations/functions";
import { linkMyLabsMutationOptions, myLabQueryOptions } from "@/server/simulations/query-options";

const HEADING = "my-lab-heading";

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
    const { queryKey } = myLabQueryOptions();
    const before = queryClient.getQueryData(queryKey) ?? null;
    mutate(undefined, {
      // Runs after the mutation's own `onSettled` has read the lab again, so `after` is fresh.
      onSuccess: (outcome) => {
        const after = queryClient.getQueryData(queryKey) ?? null;
        const message = linkedMessage(outcome.linked, before, after);
        if (message) toast.success(message);
      },
      onError: () => toast.error(m.student_labs_link_failed()),
    });
  }, [mutate, queryClient]);
}

/**
 * The signed-in student's one current lab on the Student portal overview (S10, #379): its name
 * and its simulation, nothing of another lab, with the lab's logo or, without one, the lab icon
 * (#293). A finished simulation's lab stays here, read-only, until the student joins a new one.
 */
export function StudentLabs() {
  useLinkOnOpen();
  const { data: lab, isFetching } = useSuspenseQuery(myLabQueryOptions());
  return (
    <section aria-labelledby={HEADING} className="flex flex-col gap-4">
      <h2 id={HEADING} className="text-lg font-semibold">
        {m.student_labs_heading()}
      </h2>
      <div className="relative flex flex-col gap-3" aria-busy={isFetching}>
        <UpdatingIndicator active={isFetching} />
        {lab === null ? (
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
          <>
            <Item variant="outline" className="max-w-md">
              <ItemMedia>
                {/* Decorative: the lab's name is the item's title right beside it. */}
                <LabLogo
                  src={lab.logoVersion === null ? null : labLogoSrc(lab.labId, lab.logoVersion)}
                  alt=""
                  size="md"
                />
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle className="break-words">{lab.labName}</ItemTitle>
                <ItemDescription className="break-words">
                  {m.student_labs_simulation({ simulation: lab.simulationName })}
                </ItemDescription>
              </ItemContent>
            </Item>
            {lab.state === "finished" ? (
              <Alert className="max-w-md">
                <InfoIcon aria-hidden="true" />
                <AlertDescription>{m.student_labs_finished()}</AlertDescription>
              </Alert>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
