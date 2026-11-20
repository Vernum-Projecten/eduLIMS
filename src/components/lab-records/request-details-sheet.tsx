// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { DialogControl } from "@/components/simulations/name-dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import { requestKindLabel } from "@/lib/i18n/records-labels";
import type { NotOfferedTest } from "@/lib/lab-records";
import type { RequestRow } from "@/server/lab-records/queries";
import { CopyAnnouncer, LabNumber } from "./lab-number";
import { ScrollRegion } from "./scroll-region";

/** Returns a test not offered as one line: its name, with its remark in brackets. */
export function notOfferedText(entry: NotOfferedTest): string {
  return entry.remark === null
    ? entry.name
    : m.records_not_offered_entry({ name: entry.name, remark: entry.remark });
}

/** Returns the name of a request: its patient, or the kind for a control request. */
export function requestTitle(request: RequestRow, patientName: string | undefined): string {
  return patientName
    ? m.records_request_for({ name: patientName })
    : requestKindLabel(request.kind);
}

function Detail({ term, children }: Readonly<{ term: string; children: ReactNode }>) {
  return (
    <>
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="break-words">{children}</dd>
    </>
  );
}

/**
 * Everything the team recorded for one request (S12, S16, #398), in a sheet: its kind and
 * patient (a link to the patient), the time of entry, the requester, the requested tests, the
 * tests not offered as typed, the remarks, and the samples with their lab numbers. It only
 * reads; correcting is the row's menu. The sheet has its own status region for a copied lab
 * number, since a modal hides the page's (WCAG 4.1.3).
 */
export function RequestDetailsSheet({
  control,
  request,
  patientName,
}: Readonly<{
  control: DialogControl;
  request: RequestRow | undefined;
  patientName: string | undefined;
}>) {
  const title = request ? requestTitle(request, patientName) : "";
  return (
    <Sheet open={control.open && request !== undefined} onOpenChange={control.onOpenChange}>
      <SheetContent
        className="w-full overflow-y-auto sm:max-w-xl"
        onCloseAutoFocus={control.onCloseAutoFocus}
      >
        <SheetHeader>
          <SheetTitle className="pr-8 break-words">{title}</SheetTitle>
          <SheetDescription>{m.records_request_details_body()}</SheetDescription>
        </SheetHeader>
        {request ? (
          <CopyAnnouncer>
            <div className="flex flex-col gap-6 px-4">
              <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
                <Detail term={m.records_kind()}>{requestKindLabel(request.kind)}</Detail>
                {request.patientId && patientName ? (
                  <Detail term={m.records_request_patient()}>
                    <Link
                      to="/student/patients"
                      search={{ patient: request.patientId }}
                      className="underline underline-offset-4"
                    >
                      {patientName}
                    </Link>
                  </Detail>
                ) : null}
                <Detail term={m.records_entered_label()}>
                  <time dateTime={request.enteredAt}>{formatDateTime(request.enteredAt)}</time>
                </Detail>
                <Detail term={m.records_requester()}>
                  {request.requester ?? m.records_none()}
                </Detail>
                <Detail term={m.records_phone_through()}>
                  {request.phoneThrough ? m.records_yes() : m.records_no()}
                </Detail>
                <Detail term={m.records_tests()}>
                  {request.tests.map((test) => test.name).join(", ")}
                </Detail>
                <Detail term={m.records_not_offered()}>
                  {request.notOffered.length === 0 ? (
                    m.records_none()
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {request.notOffered.map((entry, index) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: the stored order is the list's identity.
                        <li key={index}>{notOfferedText(entry)}</li>
                      ))}
                    </ul>
                  )}
                </Detail>
                <Detail term={m.records_remarks()}>
                  <span className="whitespace-pre-line">{request.remarks ?? m.records_none()}</span>
                </Detail>
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
                        <TableHead
                          scope="row"
                          className="font-medium break-words whitespace-normal"
                        >
                          {sample.sampleNumber}
                        </TableHead>
                        <TableCell className="break-words whitespace-normal">
                          {sample.material}
                        </TableCell>
                        <TableCell>
                          <LabNumber value={sample.labNumber} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollRegion>
            </div>
          </CopyAnnouncer>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
