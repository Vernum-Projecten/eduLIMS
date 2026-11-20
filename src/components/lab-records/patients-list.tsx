// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FileTextIcon, PencilIcon, PlusIcon, UserRoundIcon } from "lucide-react";
import { createContext, use, useMemo, useRef } from "react";
import { createDataTableColumnHelper } from "@/components/data-table/features";
import { PageFrame } from "@/components/shell/page-frame";
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
import {
  AllPatientsLink,
  RecordStatus,
  RecordsActionButton,
  RecordsContext,
  RecordsFilter,
} from "./student-records";
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

const TableContext = createContext<PatientsTableContext | null>(null);

function useTableContext(): PatientsTableContext {
  const context = use(TableContext);
  if (context === null) throw new Error("a patients row renders outside its table");
  return context;
}

const helper = createDataTableColumnHelper<PatientListRow>();

const columns = helper.columns([
  helper.accessor("name", {
    id: "name",
    header: () => m.records_patient_name(),
    cell: ({ row }) => (
      <span className="font-medium break-words whitespace-normal">{row.original.name}</span>
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
  helper.accessor("locked", {
    id: "status",
    header: () => m.records_col_status(),
    cell: ({ row }) => <RecordStatus locked={row.original.locked} />,
  }),
  helper.display({
    id: "actions",
    meta: { className: "w-12" },
    header: () => <span className="sr-only">{m.data_table_actions()}</span>,
    cell: ({ row }) => <PatientRowActions patient={row.original} />,
  }),
]);

function PatientRowActions({ patient }: Readonly<{ patient: PatientListRow }>) {
  const { running, correct } = useTableContext();
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <RowActions label={m.data_table_row_actions({ name: patient.name })} triggerRef={trigger}>
      {patient.locked ? null : (
        <DropdownMenuItem disabled={!running} onSelect={() => correct(patient, trigger.current)}>
          <PencilIcon aria-hidden="true" />
          {m.records_correct()}
        </DropdownMenuItem>
      )}
      <DropdownMenuItem asChild>
        <Link to="/student/requests" search={{ patient: patient.id }}>
          <FileTextIcon aria-hidden="true" />
          {m.records_view_requests()}
        </Link>
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
 * The patients of the student's lab (S11, #380): the list with each patient's requests and
 * whether it can still be corrected; registering is the page's one action, correcting sits in
 * the row's menu. With `patientId` the list shows that patient alone, the target of the link
 * from a request. Nothing of another lab and no correct value (Q-SIM-1).
 */
export function PatientsView({
  lab,
  patientId,
}: Readonly<{ lab: StudentLabRow; patientId: string | undefined }>) {
  const section = sectionOf("student", "patients");
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
  const chosen = rows.find((row) => row.id === patientId);
  const shown = useMemo(() => (chosen ? [chosen] : rows), [chosen, rows]);
  const context: PatientsTableContext = {
    running: records.running,
    correct: (patient, opener) => dialog.openWith(opener, patient),
  };
  return (
    <PageFrame
      title={section.label()}
      description={section.description()}
      action={
        <RecordsActionButton enabled={records.running} onOpen={(event) => dialog.openFrom(event)}>
          <PlusIcon aria-hidden="true" data-icon="inline-start" />
          {m.records_patient_register()}
        </RecordsActionButton>
      }
    >
      <RecordsContext lab={lab.labName} simulation={lab.simulationName} running={records.running} />
      {chosen ? (
        <RecordsFilter text={m.records_patient_filter({ name: chosen.name })}>
          <AllPatientsLink />
        </RecordsFilter>
      ) : null}
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
      <PatientDialog
        key={dialog.key}
        control={dialog.control}
        labId={records.labId}
        patient={dialog.row}
      />
    </PageFrame>
  );
}
