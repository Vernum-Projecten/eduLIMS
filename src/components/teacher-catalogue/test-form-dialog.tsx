// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { revalidateLogic } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { SaveIcon } from "lucide-react";
import { useAppForm } from "@/components/form/app-form";
import { useCatalogueMutation } from "@/components/teacher-catalogue/use-catalogue-mutation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { m } from "@/i18n/messages";
import {
  EPOCH_CALCULATORS,
  type LockableTestField,
  lockedTestFields,
  TEST_ANALYTE_MAX,
  TEST_MATERIAL_MAX,
  TEST_NAME_MAX,
  TEST_SOURCES,
  TEST_UNIT_MAX,
  type TestSourceKind,
  type TestUsage,
} from "@/lib/catalogue";
import { applyServerRefusal, type ServerRefusal } from "@/lib/forms/server-refusal";
import {
  catalogueErrorMessage,
  epochCalculatorLabel,
  testSourceLabel,
} from "@/lib/i18n/catalogue-labels";
import { createCatalogueTest, updateCatalogueTest } from "@/server/catalogue/functions";
import type { CatalogueTestRow } from "@/server/catalogue/queries";
import {
  type CatalogueErrorCode,
  catalogueErrorCode,
  createTestMutationOptions,
  updateTestMutationOptions,
} from "@/server/catalogue/query-options";
import { type TestForm, testFormSchema } from "@/server/catalogue/schemas";

const EMPTY: TestForm = {
  name: "",
  unit: "",
  material: "",
  source: "",
  analyte: "",
  calculatedBy: "",
};

function valuesOf(row: CatalogueTestRow | undefined): TestForm {
  if (!row) return EMPTY;
  const base = { ...EMPTY, name: row.name, unit: row.unit ?? "", material: row.material };
  switch (row.source.kind) {
    case "afinion":
      return { ...base, source: "afinion", analyte: row.source.analyte };
    case "epoch_upload":
      return { ...base, source: "epoch_upload", calculatedBy: row.source.calculatedBy };
    case "manual":
      return { ...base, source: "manual" };
    default: {
      const unknown: never = row.source;
      return unknown;
    }
  }
}

/** Where a refusal shows: a taken name or analyte at its field, anything else at the top. */
function refusalFor(code: CatalogueErrorCode): ServerRefusal<TestForm> {
  const message = catalogueErrorMessage(code);
  switch (code) {
    case "name_taken":
      return { fields: { name: message } };
    case "analyte_taken":
      return { fields: { analyte: message } };
    default:
      return { form: message };
  }
}

/** What a used test leaves open to change: only the settings of its own source are named. */
function inUseDescription(source: TestSourceKind): string {
  switch (source) {
    case "afinion":
      return m.catalogue_form_in_use_afinion();
    case "epoch_upload":
      return m.catalogue_form_in_use_epoch();
    case "manual":
      return m.catalogue_form_in_use_manual();
    default: {
      const unknown: never = source;
      return unknown;
    }
  }
}

/** The dialog's description: what the use of the test leaves open to change. */
function descriptionOf(test: CatalogueTestRow | undefined): string {
  switch (test?.usage) {
    case "used":
      return inUseDescription(test.source.kind);
    case "running":
      return m.catalogue_form_in_running_simulation();
    default:
      return m.catalogue_form_description();
  }
}

/** Why a field is read-only, beside it (WCAG 3.3.2); the same reason as the description. */
function lockReason(usage: TestUsage): string {
  return usage === "running" ? m.catalogue_locked_running() : m.catalogue_locked_used();
}

/** Where the dialog opens from: the parent controls it and gets focus back on close. */
export interface TestDialogControl {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
}

/**
 * The create and edit form of a test (D9, #266) in a dialog, on `useAppForm` with the schema the
 * server function validates with. The analyte shows for an Afinion 2 test and the calculator for
 * an Epoch 2 test, the only sources they belong to. A setting the test's usage fixes is
 * read-only, still focusable, with its reason as its description; the server refuses the same
 * change. A taken name or analyte shows at its field; any other refusal at the top of the form,
 * focused (WCAG 3.3.1).
 */
export function TestFormDialog({
  test,
  control,
}: Readonly<{ test?: CatalogueTestRow; control: TestDialogControl }>) {
  const queryClient = useQueryClient();
  const callCreate = useServerFn(createCatalogueTest);
  const callUpdate = useServerFn(updateCatalogueTest);
  const create = useCatalogueMutation(
    createTestMutationOptions(queryClient, callCreate),
    (_id, data) => m.catalogue_created({ name: data.name.trim() }),
    false,
  );
  const update = useCatalogueMutation(
    updateTestMutationOptions(queryClient, callUpdate),
    (_id, data) => m.catalogue_updated({ name: data.test.name.trim() }),
    false,
  );
  const form = useAppForm({
    defaultValues: valuesOf(test),
    validationLogic: revalidateLogic(),
    validators: { onDynamic: testFormSchema },
    onSubmit: async ({ value, formApi }) => {
      try {
        if (test) await update.mutateAsync({ testId: test.id, test: value });
        else await create.mutateAsync(value);
      } catch (error) {
        applyServerRefusal(formApi, refusalFor(catalogueErrorCode(error)));
        return;
      }
      control.onOpenChange(false);
      formApi.reset();
    },
  });

  const title = test ? m.catalogue_edit_title({ name: test.name }) : m.catalogue_create_title();
  const usage = test?.usage ?? "unused";
  const locked = lockedTestFields(usage);
  const help = (field: LockableTestField, description: string) =>
    locked.has(field) ? lockReason(usage) : description;

  return (
    <Dialog
      open={control.open}
      onOpenChange={(open) => {
        if (!open) form.reset(valuesOf(test));
        control.onOpenChange(open);
      }}
    >
      {/* The form is taller than a short or zoomed viewport, so the dialog scrolls (WCAG 1.4.10). */}
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
        onCloseAutoFocus={control.onCloseAutoFocus}
      >
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.AppForm>
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{descriptionOf(test)}</DialogDescription>
            </DialogHeader>
            <form.FormErrors />
            <FieldGroup>
              <form.AppField name="name">
                {(field) => (
                  <field.TextField
                    label={m.catalogue_name()}
                    description={m.catalogue_name_help()}
                    maxLength={TEST_NAME_MAX}
                    autoComplete="off"
                  />
                )}
              </form.AppField>
              <form.AppField name="unit">
                {(field) => (
                  <field.TextField
                    label={m.catalogue_unit_optional()}
                    description={help("unit", m.catalogue_unit_help())}
                    readOnly={locked.has("unit")}
                    maxLength={TEST_UNIT_MAX}
                    autoComplete="off"
                    spellCheck={false}
                  />
                )}
              </form.AppField>
              <form.AppField name="material">
                {(field) => (
                  <field.TextField
                    label={m.catalogue_material()}
                    description={help("material", m.catalogue_material_help())}
                    readOnly={locked.has("material")}
                    maxLength={TEST_MATERIAL_MAX}
                    autoComplete="off"
                  />
                )}
              </form.AppField>
              <form.AppField name="source">
                {(field) => (
                  <field.SelectField
                    label={m.catalogue_source()}
                    description={help("source", m.catalogue_source_help())}
                    readOnly={locked.has("source")}
                    placeholder={m.catalogue_source_placeholder()}
                    options={TEST_SOURCES.map((source) => ({
                      value: source,
                      label: testSourceLabel(source),
                    }))}
                  />
                )}
              </form.AppField>
              <form.Subscribe selector={(state) => state.values.source}>
                {(source) =>
                  source === "afinion" ? (
                    <form.AppField name="analyte">
                      {(field) => (
                        <field.TextField
                          label={m.catalogue_analyte()}
                          description={help("analyte", m.catalogue_analyte_help())}
                          readOnly={locked.has("analyte")}
                          maxLength={TEST_ANALYTE_MAX}
                          autoComplete="off"
                          spellCheck={false}
                        />
                      )}
                    </form.AppField>
                  ) : source === "epoch_upload" ? (
                    <form.AppField name="calculatedBy">
                      {(field) => (
                        <field.RadioGroupField
                          label={m.catalogue_calculated_by()}
                          description={help("calculatedBy", m.catalogue_calculated_by_help())}
                          readOnly={locked.has("calculatedBy")}
                          options={EPOCH_CALCULATORS.map((calculator) => ({
                            value: calculator,
                            label: epochCalculatorLabel(calculator),
                          }))}
                        />
                      )}
                    </form.AppField>
                  ) : null
                }
              </form.Subscribe>
            </FieldGroup>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {m.common_cancel()}
                </Button>
              </DialogClose>
              <form.SubmitButton icon={<SaveIcon aria-hidden="true" data-icon="inline-start" />}>
                {test ? m.catalogue_save() : m.catalogue_create()}
              </form.SubmitButton>
            </DialogFooter>
          </form.AppForm>
        </form>
      </DialogContent>
    </Dialog>
  );
}
