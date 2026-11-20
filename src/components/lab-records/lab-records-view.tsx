// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { LockIcon, PencilIcon, PhoneIcon, PlusIcon, UserRoundIcon } from "lucide-react";
import type { MouseEvent } from "react";
import { UpdatingIndicator } from "@/components/shell/updating-indicator";
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
import { formatDate, formatDateTime } from "@/lib/i18n/format";
import { requestKindLabel, sexLabel } from "@/lib/i18n/records-labels";
import type { LabRecords, PatientRow, RequestRow } from "@/server/lab-records/queries";
import {
  labRecordsQueryOptions,
  requestableTestsQueryOptions,
} from "@/server/lab-records/query-options";
import { CopyAnnouncer, LabNumber } from "./lab-number";
import { PatientDialog } from "./patient-dialog";
import { RequestDialog } from "./request-dialog";
import { ScrollRegion } from "./scroll-region";
import { useRecordDialog } from "./use-record-dialog";

/** The badge of a record whose first result is released, with an icon and text (WCAG 1.4.1). */
function LockedBadge() {
  return (
    <Badge variant="secondary">
      <LockIcon aria-hidden="true" data-icon="inline-start" />
      {m.records_locked()}
    </Badge>
  );
}

function PatientsSection({ records }: Readonly<{ records: LabRecords }>) {
  const dialog = useRecordDialog<PatientRow>();
  return (
    <section aria-labelledby="patients-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="patients-heading" className="font-semibold text-lg">
          {m.records_patients_heading()}
        </h2>
        <Button
          type="button"
          disabled={!records.running}
          onClick={(event) => dialog.openFrom(event)}
        >
          <PlusIcon aria-hidden="true" data-icon="inline-start" />
          {m.records_patient_register()}
        </Button>
      </div>
      {records.patients.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UserRoundIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>{m.records_patients_empty_title()}</EmptyTitle>
            <EmptyDescription>{m.records_patients_empty_body()}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ScrollRegion label={m.records_patients_table()}>
          <Table>
            <TableCaption className="sr-only">{m.records_patients_heading()}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{m.records_patient_name()}</TableHead>
                <TableHead scope="col">{m.records_patient_birth()}</TableHead>
                <TableHead scope="col">{m.records_patient_sex()}</TableHead>
                <TableHead scope="col">{m.records_patient_identifier()}</TableHead>
                <TableHead scope="col">{m.records_actions()}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.patients.map((patient) => (
                <TableRow key={patient.id}>
                  <TableHead scope="row" className="whitespace-normal break-words font-medium">
                    {patient.name}
                  </TableHead>
                  <TableCell>
                    <time dateTime={patient.dateOfBirth}>{formatDate(patient.dateOfBirth)}</time>
                  </TableCell>
                  <TableCell>{sexLabel(patient.sex)}</TableCell>
                  <TableCell className="whitespace-normal break-words">
                    {patient.identifier}
                  </TableCell>
                  <TableCell>
                    {patient.locked ? (
                      <LockedBadge />
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!records.running}
                        aria-label={m.records_patient_correct({ name: patient.name })}
                        onClick={(event) => dialog.openFrom(event, patient)}
                      >
                        <PencilIcon aria-hidden="true" data-icon="inline-start" />
                        {m.records_correct()}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollRegion>
      )}
      <PatientDialog
        key={dialog.key}
        control={dialog.control}
        labId={records.labId}
        patient={dialog.row}
      />
    </section>
  );
}

function RequestCard({
  request,
  records,
  onCorrect,
}: Readonly<{
  request: RequestRow;
  records: LabRecords;
  onCorrect: (event: MouseEvent<HTMLButtonElement>) => void;
}>) {
  const patient = records.patients.find((row) => row.id === request.patientId);
  const title = patient
    ? m.records_request_for({ name: patient.name })
    : requestKindLabel(request.kind);
  const headingId = `request-${request.id}`;
  return (
    <li>
      <article aria-labelledby={headingId} className="flex flex-col gap-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col gap-1">
            <h3 id={headingId} className="font-medium">
              {title}
            </h3>
            <p className="text-muted-foreground text-sm">
              {m.records_entered_label()}{" "}
              <time dateTime={request.enteredAt}>{formatDateTime(request.enteredAt)}</time>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{requestKindLabel(request.kind)}</Badge>
            {request.phoneThrough ? (
              <Badge variant="outline">
                <PhoneIcon aria-hidden="true" data-icon="inline-start" />
                {m.records_phone_through()}
              </Badge>
            ) : null}
            {request.locked ? (
              <LockedBadge />
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!records.running}
                aria-label={m.records_request_correct({ title })}
                onClick={onCorrect}
              >
                <PencilIcon aria-hidden="true" data-icon="inline-start" />
                {m.records_correct()}
              </Button>
            )}
          </div>
        </div>
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-muted-foreground">{m.records_requester()}</dt>
          <dd>{request.requester ?? m.records_none()}</dd>
          <dt className="text-muted-foreground">{m.records_tests()}</dt>
          <dd>{request.tests.map((test) => test.name).join(", ")}</dd>
          <dt className="text-muted-foreground">{m.records_remarks()}</dt>
          <dd className="whitespace-pre-line break-words">{request.remarks ?? m.records_none()}</dd>
        </dl>
        <ScrollRegion label={m.records_samples_of({ title })}>
          <Table>
            <TableCaption className="sr-only">{m.records_samples_of({ title })}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{m.records_sample_number()}</TableHead>
                <TableHead scope="col">{m.records_sample_material()}</TableHead>
                <TableHead scope="col">{m.records_lab_number()}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {request.samples.map((sample) => (
                <TableRow key={sample.id}>
                  <TableHead scope="row" className="whitespace-normal break-words font-medium">
                    {sample.sampleNumber}
                  </TableHead>
                  <TableCell className="whitespace-normal break-words">{sample.material}</TableCell>
                  <TableCell>
                    <LabNumber value={sample.labNumber} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollRegion>
      </article>
    </li>
  );
}

function RequestsSection({ records }: Readonly<{ records: LabRecords }>) {
  const { data: tests } = useSuspenseQuery(requestableTestsQueryOptions());
  const dialog = useRecordDialog<RequestRow>();
  return (
    <section aria-labelledby="requests-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="requests-heading" className="font-semibold text-lg">
          {m.records_requests_heading()}
        </h2>
        <Button
          type="button"
          disabled={!records.running}
          onClick={(event) => dialog.openFrom(event)}
        >
          <PlusIcon aria-hidden="true" data-icon="inline-start" />
          {m.records_request_record()}
        </Button>
      </div>
      {records.requests.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>{m.records_requests_empty_title()}</EmptyTitle>
            <EmptyDescription>{m.records_requests_empty_body()}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ol className="flex flex-col gap-3">
          {records.requests.map((request) => (
            <RequestCard
              key={request.id}
              request={request}
              records={records}
              onCorrect={(event) => dialog.openFrom(event, request)}
            />
          ))}
        </ol>
      )}
      <RequestDialog
        key={dialog.key}
        control={dialog.control}
        records={records}
        tests={tests}
        request={dialog.row}
      />
    </section>
  );
}

/**
 * The records of one lab (S11, S12, S16): its patients and its requests with their samples and
 * lab numbers, as the team entered them, and nothing of another lab and no correct value
 * (Q-SIM-1). Writing is open only while the simulation runs.
 */
export function LabRecordsView({ labId }: Readonly<{ labId: string }>) {
  const { data: records, isFetching } = useSuspenseQuery(labRecordsQueryOptions(labId));
  return (
    <CopyAnnouncer>
      <div className="relative flex flex-col gap-8" aria-busy={isFetching}>
        <UpdatingIndicator active={isFetching} />
        {records.running ? null : (
          <Alert>
            <LockIcon aria-hidden="true" />
            <AlertTitle>{m.records_not_running_title()}</AlertTitle>
            <AlertDescription>{m.records_not_running_body()}</AlertDescription>
          </Alert>
        )}
        <PatientsSection records={records} />
        <RequestsSection records={records} />
      </div>
    </CopyAnnouncer>
  );
}
