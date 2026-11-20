// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { FlaskConicalIcon, LockIcon, PlusIcon, XIcon } from "lucide-react";
import {
  type ComponentProps,
  type Context,
  createContext,
  type MouseEvent,
  type ReactNode,
  use,
} from "react";
import { DataTableSkeleton } from "@/components/data-table/data-table";
import { PageFrame } from "@/components/shell/page-frame";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { m } from "@/i18n/messages";
import type { NavItem } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import type { StudentLabRow } from "@/server/simulations/queries";

/** The loading state of a records page: its frame and skeleton rows. */
export function RecordsPending({ section }: Readonly<{ section: NavItem }>) {
  return (
    <PageFrame title={section.label()} description={section.description()}>
      <DataTableSkeleton rows={4} />
    </PageFrame>
  );
}

/** A records page for a student in no lab: what is missing and where it is fixed (#384, 6). */
export function NoLabPage({ section }: Readonly<{ section: NavItem }>) {
  return (
    <PageFrame title={section.label()} description={section.description()}>
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FlaskConicalIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>{m.student_labs_empty_title()}</EmptyTitle>
          <EmptyDescription>{m.student_labs_empty_body()}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </PageFrame>
  );
}

/**
 * The button that opens a records dialog. While the simulation does not run it stays in the tab
 * order with `aria-disabled`, so the keyboard and a screen reader still find it and the alert
 * above says why; a press does nothing (WCAG 4.1.2).
 */
export function RecordsActionButton({
  enabled,
  onOpen,
  className,
  ...props
}: Readonly<
  Omit<ComponentProps<typeof Button>, "onClick" | "disabled"> & {
    enabled: boolean;
    onOpen: (event: MouseEvent<HTMLButtonElement>) => void;
  }
>) {
  return (
    <Button
      type="button"
      {...props}
      aria-disabled={enabled ? undefined : true}
      className={cn("aria-disabled:cursor-not-allowed aria-disabled:opacity-50", className)}
      onClick={(event) => {
        if (enabled) onOpen(event);
      }}
    />
  );
}

/** The one exception a record shows: a released result locks it, with an icon and text (1.4.1). */
export function LockedBadge({ locked }: Readonly<{ locked: boolean }>) {
  if (!locked) return null;
  return (
    <Badge variant="secondary">
      <LockIcon aria-hidden="true" data-icon="inline-start" />
      {m.records_locked()}
    </Badge>
  );
}

/** The patient a records page is filtered to, as `?patient=` names it. */
export type PatientFilter =
  | { kind: "none" }
  | { kind: "found"; name: string }
  | { kind: "unknown" };

/**
 * Returns the filter of `patientId` among the lab's `patients`: a malformed id never reaches here
 * (the search schema drops it), and an id of no patient of the lab is `unknown`, which shows no
 * record and says so, the same for another lab's patient and a deleted one (S10).
 */
export function patientFilter(
  patientId: string | undefined,
  patients: readonly { id: string; name: string }[],
): PatientFilter {
  if (patientId === undefined) return { kind: "none" };
  const patient = patients.find((row) => row.id === patientId);
  return patient ? { kind: "found", name: patient.name } : { kind: "unknown" };
}

/**
 * The frame of the student's patients and requests pages (#380, #384): the title, the sentence,
 * the one primary action, the lab and simulation the page shows, the not-running alert (the
 * page's one statement of that state, #384, 5), the filter line, then the list and its dialogs.
 */
export function RecordsPage({
  section,
  lab,
  running,
  action,
  onAction,
  filter,
  filterText,
  clearFilter,
  children,
}: Readonly<{
  section: NavItem;
  lab: StudentLabRow;
  running: boolean;
  action: string;
  onAction: (event: MouseEvent<HTMLButtonElement>) => void;
  filter: PatientFilter;
  filterText: (name: string) => string;
  clearFilter: ReactNode;
  children: ReactNode;
}>) {
  return (
    <PageFrame
      title={section.label()}
      description={section.description()}
      action={
        <RecordsActionButton enabled={running} onOpen={onAction}>
          <PlusIcon aria-hidden="true" data-icon="inline-start" />
          {action}
        </RecordsActionButton>
      }
    >
      <p className="text-muted-foreground">
        {m.records_lab_choice({ lab: lab.labName, simulation: lab.simulationName })}
      </p>
      {running ? null : (
        <Alert>
          <LockIcon aria-hidden="true" />
          <AlertTitle>{m.records_not_running_title()}</AlertTitle>
          <AlertDescription>{m.records_not_running_body()}</AlertDescription>
        </Alert>
      )}
      {filter.kind === "none" ? null : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p>{filter.kind === "found" ? filterText(filter.name) : m.records_patient_unknown()}</p>
          <Button asChild variant="outline" size="sm">
            {clearFilter}
          </Button>
        </div>
      )}
      {children}
    </PageFrame>
  );
}

/** The icon of the link that clears a filter. */
export function ClearIcon() {
  return <XIcon aria-hidden="true" data-icon="inline-start" />;
}

/**
 * Returns a context for what a list's rows need from their page (whether the lab can write, the
 * dialogs to open) and the hook that reads it, failing loud outside its provider.
 */
export function rowContext<T>(name: string): [Context<T | null>, () => T] {
  const context = createContext<T | null>(null);
  return [
    context,
    () => {
      const value = use(context);
      if (value === null) throw new Error(`a ${name} row renders outside its table`);
      return value;
    },
  ];
}
