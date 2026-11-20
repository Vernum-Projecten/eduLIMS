// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Link } from "@tanstack/react-router";
import { FlaskConicalIcon, LockIcon, PencilIcon, XIcon } from "lucide-react";
import type { ComponentProps, MouseEvent, ReactNode } from "react";
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
 * The lab and simulation the page shows, and, while the simulation does not run, why nothing
 * can be entered (D10, #267). The alert is the page's one statement of that state (#384, 5).
 */
export function RecordsContext({
  lab,
  simulation,
  running,
}: Readonly<{ lab: string; simulation: string; running: boolean }>) {
  return (
    <>
      <p className="text-muted-foreground">{m.records_lab_choice({ lab, simulation })}</p>
      {running ? null : (
        <Alert>
          <LockIcon aria-hidden="true" />
          <AlertTitle>{m.records_not_running_title()}</AlertTitle>
          <AlertDescription>{m.records_not_running_body()}</AlertDescription>
        </Alert>
      )}
    </>
  );
}

/**
 * The button that opens a records dialog. While the simulation does not run it stays in the tab
 * order with `aria-disabled`, so the keyboard and a screen reader still find it and the alert
 * above says why; a click does nothing (WCAG 4.1.2).
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

/** Whether a record can still be corrected, with an icon and text (WCAG 1.4.1, #384, 5). */
export function RecordStatus({ locked }: Readonly<{ locked: boolean }>) {
  return locked ? (
    <Badge variant="secondary">
      <LockIcon aria-hidden="true" data-icon="inline-start" />
      {m.records_locked()}
    </Badge>
  ) : (
    <Badge variant="outline">
      <PencilIcon aria-hidden="true" data-icon="inline-start" />
      {m.records_status_open()}
    </Badge>
  );
}

/** The line above a list that shows one patient's records, with the way back to all of them. */
export function RecordsFilter({ text, children }: Readonly<{ text: string; children: ReactNode }>) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <p>{text}</p>
      <Button asChild variant="outline" size="sm">
        {children}
      </Button>
    </div>
  );
}

/** The link back to every patient. */
export function AllPatientsLink() {
  return (
    <Link to="/student/patients">
      <XIcon aria-hidden="true" data-icon="inline-start" />
      {m.records_show_all_patients()}
    </Link>
  );
}

/** The link back to every request. */
export function AllRequestsLink() {
  return (
    <Link to="/student/requests">
      <XIcon aria-hidden="true" data-icon="inline-start" />
      {m.records_show_all_requests()}
    </Link>
  );
}
