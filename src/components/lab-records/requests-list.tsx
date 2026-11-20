// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FileTextIcon, PencilIcon, PhoneIcon, UserRoundIcon } from "lucide-react";
import { useMemo, useRef } from "react";
import { createDataTableColumnHelper } from "@/components/data-table/features";
import { RowActions } from "@/components/shell/row-actions";
import { ListTable } from "@/components/simulations/list-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { m } from "@/i18n/messages";
import { byCount, formatDateTime, formatList } from "@/lib/i18n/format";
import { sectionOf } from "@/lib/navigation";
import type { RequestRow } from "@/server/lab-records/queries";
import {
  labRecordsQueryOptions,
  requestableTestsQueryOptions,
} from "@/server/lab-records/query-options";
import type { StudentLabRow } from "@/server/simulations/queries";
import { CopyAnnouncer, LabNumber } from "./lab-number";
import { RequestDetailsSheet, requestTitle } from "./request-details-sheet";
import { RequestDialog } from "./request-dialog";
import { ClearIcon, LockedBadge, patientFilter, RecordsPage, rowContext } from "./student-records";
import { useRecordDialog } from "./use-record-dialog";

/** A request in the list, with the name the list shows for it. */
interface RequestListRow extends RequestRow {
  title: string;
}

/** What a row needs from the page: whether the lab can write, and the sheet and the dialog. */
interface RequestsTableContext {
  running: boolean;
  details: (request: RequestRow, opener: HTMLElement | null) => void;
  correct: (request: RequestRow, opener: HTMLElement | null) => void;
}

const [TableContext, useTableContext] = rowContext<RequestsTableContext>("requests");

/** The request's name, a button that opens its details, with its time of entry and badges. */
function RequestCell({ request }: Readonly<{ request: RequestListRow }>) {
  const { details } = useTableContext();
  return (
    <div className="flex min-w-40 flex-col items-start gap-1">
      <Button
        type="button"
        variant="link"
        className="h-auto p-0 text-left font-medium break-words whitespace-normal"
        onClick={(event) => details(request, event.currentTarget)}
      >
        {request.title}
      </Button>
      <span className="font-normal text-muted-foreground text-sm">
        {m.records_entered_label()}{" "}
        <time dateTime={request.enteredAt}>{formatDateTime(request.enteredAt)}</time>
      </span>
      <span className="flex flex-wrap gap-1">
        {request.phoneThrough ? (
          <Badge variant="outline">
            <PhoneIcon aria-hidden="true" data-icon="inline-start" />
            {m.records_phone_through()}
          </Badge>
        ) : null}
        <LockedBadge locked={request.locked} />
      </span>
    </div>
  );
}

const helper = createDataTableColumnHelper<RequestListRow>();

const columns = helper.columns([
  helper.accessor("title", {
    id: "request",
    header: () => m.records_col_request(),
    meta: { rowHeader: true },
    cell: ({ row }) => <RequestCell request={row.original} />,
  }),
  helper.accessor("tests", {
    id: "tests",
    header: () => m.records_tests(),
    cell: ({ row }) => (
      <div className="flex min-w-32 flex-col gap-1 whitespace-normal">
        <span className="break-words">
          {formatList(row.original.tests.map((test) => test.name))}
        </span>
        {row.original.notOffered.length === 0 ? null : (
          <span className="text-muted-foreground text-sm">
            {byCount(
              row.original.notOffered.length,
              (count) => m.records_not_offered_count_one({ count }),
              (count) => m.records_not_offered_count_other({ count }),
            )}
          </span>
        )}
      </div>
    ),
  }),
  helper.accessor("samples", {
    id: "samples",
    header: () => m.records_col_samples(),
    cell: ({ row }) => (
      <ul className="flex flex-col gap-1">
        {row.original.samples.map((sample) => (
          <li key={sample.id} className="flex flex-wrap items-center gap-x-2">
            <span className="break-words text-muted-foreground text-sm">{sample.sampleNumber}</span>
            <LabNumber value={sample.labNumber} />
          </li>
        ))}
      </ul>
    ),
  }),
  helper.display({
    id: "actions",
    meta: { className: "w-12" },
    header: () => <span className="sr-only">{m.data_table_actions()}</span>,
    cell: ({ row }) => <RequestRowActions request={row.original} />,
  }),
]);

/**
 * The row's menu: Correct until a result is released, and the request's patient. The name adds
 * the time of entry, so two requests for one patient have two names (WCAG 2.4.6).
 */
function RequestRowActions({ request }: Readonly<{ request: RequestListRow }>) {
  const { running, correct } = useTableContext();
  const trigger = useRef<HTMLButtonElement>(null);
  if (request.locked && request.patientId === null) return null;
  return (
    <RowActions
      label={m.records_request_actions({
        title: request.title,
        time: formatDateTime(request.enteredAt),
      })}
      triggerRef={trigger}
    >
      {request.locked ? null : (
        <DropdownMenuItem disabled={!running} onSelect={() => correct(request, trigger.current)}>
          <PencilIcon aria-hidden="true" />
          {m.records_correct()}
        </DropdownMenuItem>
      )}
      {request.patientId === null ? null : (
        <DropdownMenuItem asChild>
          <Link to="/student/patients" search={{ patient: request.patientId }}>
            <UserRoundIcon aria-hidden="true" />
            {m.records_open_patient()}
          </Link>
        </DropdownMenuItem>
      )}
    </RowActions>
  );
}

function RequestsEmpty({ patient }: Readonly<{ patient: string | undefined }>) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileTextIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>
          {patient ? m.records_requests_patient_empty_title() : m.records_requests_empty_title()}
        </EmptyTitle>
        <EmptyDescription>
          {patient
            ? m.records_requests_patient_empty_body({ name: patient })
            : m.records_requests_empty_body()}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/**
 * The requests of the student's lab (S12, S16, #380): the list with each request's tests, its
 * samples with their lab numbers to copy, and a badge on a request a released result locks.
 * Recording is the page's one action; the request's name opens its details, and the correction
 * and the patient sit in the row's menu. With `patientId` the list shows that patient's requests,
 * and a new request starts with that patient. Nothing of another lab and no correct value
 * (Q-SIM-1).
 */
export function RequestsView({
  lab,
  patientId,
}: Readonly<{ lab: StudentLabRow; patientId: string | undefined }>) {
  const { data: records, isFetching } = useSuspenseQuery(labRecordsQueryOptions(lab.labId));
  const { data: tests } = useSuspenseQuery(requestableTestsQueryOptions());
  const dialog = useRecordDialog<RequestRow>();
  const sheet = useRecordDialog<RequestRow>();
  const names = useMemo(
    () => new Map(records.patients.map((patient) => [patient.id, patient.name])),
    [records.patients],
  );
  const filter = patientFilter(patientId, records.patients);
  const chosen = filter.kind === "found" ? patientId : undefined;
  const rows = useMemo(
    () =>
      records.requests
        .filter((request) => chosen === undefined || request.patientId === chosen)
        .map((request) => ({
          ...request,
          title: requestTitle(
            request,
            request.patientId ? names.get(request.patientId) : undefined,
          ),
        })),
    [records.requests, chosen, names],
  );
  // The sheet reads the request from the cache, so a correction shows in it at once.
  const detail = records.requests.find((request) => request.id === sheet.row?.id);
  const context: RequestsTableContext = {
    running: records.running,
    details: (request, opener) => sheet.openWith(opener, request),
    correct: (request, opener) => dialog.openWith(opener, request),
  };
  return (
    <RecordsPage
      section={sectionOf("student", "requests")}
      lab={lab}
      running={records.running}
      action={m.records_request_record()}
      onAction={(event) => dialog.openFrom(event)}
      filter={filter}
      filterText={(name) => m.records_requests_filter({ name })}
      clearFilter={
        <Link to="/student/requests">
          <ClearIcon />
          {m.records_show_all_requests()}
        </Link>
      }
    >
      {filter.kind === "unknown" ? null : (
        <CopyAnnouncer>
          <TableContext value={context}>
            <ListTable
              columns={columns}
              data={rows}
              rowId={(row) => row.id}
              caption={m.records_requests_caption({ lab: lab.labName })}
              busy={isFetching}
              empty={<RequestsEmpty patient={filter.kind === "found" ? filter.name : undefined} />}
            />
          </TableContext>
        </CopyAnnouncer>
      )}
      <RequestDialog
        key={dialog.key}
        control={dialog.control}
        records={records}
        tests={tests}
        request={dialog.row}
        patientId={chosen}
      />
      <RequestDetailsSheet
        control={sheet.control}
        request={detail}
        patientName={detail?.patientId ? names.get(detail.patientId) : undefined}
        running={records.running}
        onCorrect={(request) => {
          // The dialog takes the sheet's place, so its focus goes back to the sheet's opener.
          const opener = sheet.opener();
          sheet.control.onOpenChange(false);
          dialog.openWith(opener, request);
        }}
      />
    </RecordsPage>
  );
}
