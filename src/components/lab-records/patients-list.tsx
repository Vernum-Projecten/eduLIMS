// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { PencilIcon, UserRoundIcon } from "lucide-react";
import { useMemo, useRef } from "react";
import { createDataTableColumnHelper } from "@/components/data-table/features";
import { RowActions } from "@/components/shell/row-actions";
import { ListTable } from "@/components/simulations/list-table";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { m } from "@/i18n/messages";
import { byCount, formatDate } from "@/lib/i18n/format";
import { sexLabel } from "@/lib/i18n/records-labels";
import { sectionOf } from "@/lib/navigation";
import type { PatientRow } from "@/server/lab-records/queries";
import { labRecordsQueryOptions } from "@/server/lab-records/query-options";
import type { StudentLabRow } from "@/server/simulations/queries";
import { PatientDialog } from "./patient-dialog";
import { ClearIcon, LockedBadge, patientFilter, RecordsPage, rowContext } from "./student-records";
import { useRecordDialog } from "./use-record-dialog";

/** A patient in the list, with the number of its requests. */
interface PatientListRow extends PatientRow {
  requests: number;
}

/** What a row's menu needs from the page: whether the lab can write, and the dialog. */
interface PatientsTableContext {
  running: boolean;
  correct: (patient: PatientRow, opener: HTMLElement | null) => void;
}

const [TableContext, useTableContext] = rowContext<PatientsTableContext>("patients");

const helper = createDataTableColumnHelper<PatientListRow>();

const columns = helper.columns([
  helper.accessor("name", {
    id: "name",
    header: () => m.records_patient_name(),
    meta: { rowHeader: true },
    cell: ({ row }) => (
      <span className="flex flex-wrap items-center gap-2 whitespace-normal">
        <span className="font-medium break-words">{row.original.name}</span>
        <LockedBadge locked={row.original.locked} />
      </span>
    ),
  }),
  helper.accessor("dateOfBirth", {
    id: "dateOfBirth",
    header: () => m.records_patient_birth(),
    cell: ({ row }) => (
      <time dateTime={row.original.dateOfBirth}>{formatDate(row.original.dateOfBirth)}</time>
    ),
  }),
  helper.accessor("sex", {
    id: "sex",
    header: () => m.records_patient_sex(),
    cell: ({ row }) => sexLabel(row.original.sex),
  }),
  helper.accessor("identifier", {
    id: "identifier",
    header: () => m.records_patient_identifier(),
    cell: ({ row }) => (
      <span className="break-words whitespace-normal">{row.original.identifier}</span>
    ),
  }),
  helper.accessor("requests", {
    id: "requests",
    header: () => m.records_col_requests(),
    cell: ({ row }) => (
      <Link
        to="/student/requests"
        search={{ patient: row.original.id }}
        className="underline underline-offset-4"
      >
        {byCount(
          row.original.requests,
          (count) => m.records_patient_requests_one({ count }),
          (count) => m.records_patient_requests_other({ count }),
        )}
      </Link>
    ),
  }),
  helper.display({
    id: "actions",
    meta: { className: "w-12" },
    header: () => <span className="sr-only">{m.data_table_actions()}</span>,
    cell: ({ row }) => <PatientRowActions patient={row.original} />,
  }),
]);

/** The row's menu: correcting is its one action, gone once a result is released (S11). */
function PatientRowActions({ patient }: Readonly<{ patient: PatientListRow }>) {
  const { running, correct } = useTableContext();
  const trigger = useRef<HTMLButtonElement>(null);
  if (patient.locked) return null;
  return (
    <RowActions label={m.data_table_row_actions({ name: patient.name })} triggerRef={trigger}>
      <DropdownMenuItem disabled={!running} onSelect={() => correct(patient, trigger.current)}>
        <PencilIcon aria-hidden="true" />
        {m.records_correct()}
      </DropdownMenuItem>
    </RowActions>
  );
}

function PatientsEmpty() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <UserRoundIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{m.records_patients_empty_title()}</EmptyTitle>
        <EmptyDescription>{m.records_patients_empty_body()}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/**
 * The patients of the student's lab (S11, #380): the list with each patient's requests, and a
 * badge on a patient a released result locks; registering is the page's one action, correcting
 * sits in the row's menu. With `patientId` the list shows that patient alone, the target of the
 * link from a request. Nothing of another lab and no correct value (Q-SIM-1).
 */
export function PatientsView({
  lab,
  patientId,
}: Readonly<{ lab: StudentLabRow; patientId: string | undefined }>) {
  const { data: records, isFetching } = useSuspenseQuery(labRecordsQueryOptions(lab.labId));
  const dialog = useRecordDialog<PatientRow>();
  const rows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const request of records.requests) {
      if (request.patientId !== null) {
        counts.set(request.patientId, (counts.get(request.patientId) ?? 0) + 1);
      }
    }
    return records.patients.map((patient) => ({
      ...patient,
      requests: counts.get(patient.id) ?? 0,
    }));
  }, [records]);
  const filter = patientFilter(patientId, records.patients);
  const shown = useMemo(
    () => (filter.kind === "none" ? rows : rows.filter((row) => row.id === patientId)),
    [filter.kind, rows, patientId],
  );
  const context: PatientsTableContext = {
    running: records.running,
    correct: (patient, opener) => dialog.openWith(opener, patient),
  };
  return (
    <RecordsPage
      section={sectionOf("student", "patients")}
      lab={lab}
      running={records.running}
      action={m.records_patient_register()}
      onAction={(event) => dialog.openFrom(event)}
      filter={filter}
      filterText={(name) => m.records_patient_filter({ name })}
      clearFilter={
        <Link to="/student/patients">
          <ClearIcon />
          {m.records_show_all_patients()}
        </Link>
      }
    >
      {filter.kind === "unknown" ? null : (
        <TableContext value={context}>
          <ListTable
            columns={columns}
            data={shown}
            rowId={(row) => row.id}
            caption={m.records_patients_caption({ lab: lab.labName })}
            busy={isFetching}
            empty={<PatientsEmpty />}
          />
        </TableContext>
      )}
      <PatientDialog
        key={dialog.key}
        control={dialog.control}
        labId={records.labId}
        patient={dialog.row}
      />
    </RecordsPage>
  );
}
