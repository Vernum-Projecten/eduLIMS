// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArchiveIcon, ArchiveRestoreIcon, PencilIcon } from "lucide-react";
import { useRef, useState } from "react";
import { DataTableRowActions } from "@/components/data-table/data-table-row-actions";
import { TestFormDialog } from "@/components/teacher-catalogue/test-form-dialog";
import { useCatalogueMutation } from "@/components/teacher-catalogue/use-catalogue-mutation";
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
import { restoreCatalogueTest, retireCatalogueTest } from "@/server/catalogue/functions";
import type { CatalogueTestRow } from "@/server/catalogue/queries";
import {
  restoreTestMutationOptions,
  retireTestMutationOptions,
} from "@/server/catalogue/query-options";

type OpenDialog = "edit" | "retire" | null;

/**
 * The row menu of the test catalogue (D9, #266): edit and retire an active test, the retire
 * behind a confirmation; restore a retired one. Every dialog returns focus to the menu button
 * (WCAG 2.4.3).
 */
export function TestRowActions({ test }: Readonly<{ test: CatalogueTestRow }>) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const queryClient = useQueryClient();
  const callRetire = useServerFn(retireCatalogueTest);
  const callRestore = useServerFn(restoreCatalogueTest);
  const retire = useCatalogueMutation(retireTestMutationOptions(queryClient, callRetire), () =>
    m.catalogue_retired({ name: test.name }),
  );
  const restore = useCatalogueMutation(restoreTestMutationOptions(queryClient, callRestore), () =>
    m.catalogue_restored({ name: test.name }),
  );
  const label = m.data_table_row_actions({ name: test.name });

  function returnFocus(event: Event) {
    event.preventDefault();
    triggerRef.current?.focus();
  }

  if (test.status === "retired") {
    return (
      <DataTableRowActions label={label} triggerRef={triggerRef}>
        <DropdownMenuItem
          disabled={restore.isPending}
          onSelect={() => restore.mutate({ testId: test.id })}
        >
          <ArchiveRestoreIcon aria-hidden="true" />
          {m.catalogue_restore()}
        </DropdownMenuItem>
      </DataTableRowActions>
    );
  }

  return (
    <>
      <DataTableRowActions label={label} triggerRef={triggerRef}>
        <DropdownMenuItem onSelect={() => setDialog("edit")}>
          <PencilIcon aria-hidden="true" />
          {m.catalogue_edit()}
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          disabled={retire.isPending}
          onSelect={() => setDialog("retire")}
        >
          <ArchiveIcon aria-hidden="true" />
          {m.catalogue_retire()}
        </DropdownMenuItem>
      </DataTableRowActions>
      <TestFormDialog
        test={test}
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
            <AlertDialogTitle>{m.catalogue_retire_title({ name: test.name })}</AlertDialogTitle>
            <AlertDialogDescription>{m.catalogue_retire_body()}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{m.admin_users_cancel()}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setDialog(null);
                retire.mutate({ testId: test.id });
              }}
            >
              {m.catalogue_retire_confirm()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
