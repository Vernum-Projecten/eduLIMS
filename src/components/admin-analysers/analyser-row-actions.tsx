// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArchiveIcon, PencilIcon } from "lucide-react";
import { useRef, useState } from "react";
import { AnalyserFormDialog } from "@/components/admin-analysers/analyser-form-dialog";
import { useAnalyserMutation } from "@/components/admin-analysers/use-analyser-mutation";
import { DataTableRowActions } from "@/components/data-table/data-table-row-actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { m } from "@/i18n/messages";
import { retireAdminAnalyser } from "@/server/analysers/functions";
import type { AnalyserRow } from "@/server/analysers/queries";
import { retireAnalyserMutationOptions } from "@/server/analysers/query-options";

type OpenDialog = "edit" | "retire" | null;

/** Returns the name of an analyser in a sentence: its model and serial number. */
export function analyserName(row: Pick<AnalyserRow, "model" | "serialNumber">): string {
  return m.admin_analysers_name({ model: row.model, serial: row.serialNumber });
}

/**
 * The row menu of the analyser register (B3, #35): edit, and retire behind a destructive
 * confirmation. A retired analyser has no actions: it stays in the register as a record.
 * Every dialog returns focus to the menu button (WCAG 2.4.3).
 */
export function AnalyserRowActions({ analyser }: Readonly<{ analyser: AnalyserRow }>) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const queryClient = useQueryClient();
  const callRetire = useServerFn(retireAdminAnalyser);
  const retire = useAnalyserMutation(retireAnalyserMutationOptions(queryClient, callRetire), () =>
    m.admin_analysers_retired({ name: analyserName(analyser) }),
  );
  const name = analyserName(analyser);

  if (analyser.status === "retired") {
    return <span className="sr-only">{m.admin_analysers_no_actions({ name })}</span>;
  }

  function returnFocus(event: Event) {
    event.preventDefault();
    triggerRef.current?.focus();
  }

  return (
    <>
      <DataTableRowActions label={m.data_table_row_actions({ name })} triggerRef={triggerRef}>
        <DropdownMenuItem onSelect={() => setDialog("edit")}>
          <PencilIcon aria-hidden="true" />
          {m.admin_analysers_edit()}
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          disabled={retire.isPending}
          onSelect={() => setDialog("retire")}
        >
          <ArchiveIcon aria-hidden="true" />
          {m.admin_analysers_retire()}
        </DropdownMenuItem>
      </DataTableRowActions>
      <AnalyserFormDialog
        analyser={analyser}
        control={{
          open: dialog === "edit",
          onOpenChange: (open) => setDialog(open ? "edit" : null),
          onCloseAutoFocus: returnFocus,
        }}
      />
      <AlertDialog
        open={dialog === "retire"}
        onOpenChange={(open) => setDialog(open ? "retire" : null)}
      >
        <AlertDialogContent onCloseAutoFocus={returnFocus}>
          <AlertDialogHeader>
            <AlertDialogTitle>{m.admin_analysers_retire_title({ name })}</AlertDialogTitle>
            <AlertDialogDescription>{m.admin_analysers_retire_body()}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{m.admin_users_cancel()}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setDialog(null);
                retire.mutate({ analyserId: analyser.id });
              }}
            >
              {m.admin_analysers_retire_confirm()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
