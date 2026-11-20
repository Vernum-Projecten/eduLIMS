// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { revalidateLogic, useStore } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ImageUpIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppForm } from "@/components/form/app-form";
import { simulationActionKeys } from "@/components/simulations/action-keys";
import { ConfirmDialog, useConfirmation } from "@/components/simulations/confirm-dialog";
import { FOCUSABLE_HEADING } from "@/components/simulations/focus";
import { LabLogo } from "@/components/simulations/lab-logo";
import { useSimulationAction } from "@/components/simulations/use-simulation-action";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { m } from "@/i18n/messages";
import { applyServerRefusal } from "@/lib/forms/server-refusal";
import {
  isLogoRefusal,
  logoFieldHelp,
  logoRefusalMessage,
  simulationErrorMessage,
} from "@/lib/i18n/simulation-labels";
import { LOGO_MEDIA_TYPES, labLogoSrc, precheckLogoFile } from "@/lib/lab-logo";
import { toast } from "@/lib/toast";
import { removeLabLogoFn, uploadLabLogoFn } from "@/server/simulations/functions";
import { LOGO_FORM_FIELDS, type LogoForm, logoFormSchema } from "@/server/simulations/logo-schemas";
import {
  labLogoUploadMutationOptions,
  simulationMutationOptions,
} from "@/server/simulations/query-options";

const HEADING = "lab-logo-heading";
const DEFAULTS: LogoForm = { file: null };

/** The lab a logo section is about. */
interface LogoLab {
  simulationId: string;
  labId: string;
  labName: string;
  logoVersion: string | null;
}

/**
 * The logo on the teacher's lab page (D10, #293): the current logo or the note that there is
 * none, the form that uploads or replaces it, and its removal after a confirmation.
 */
export function LabLogoSection({ lab }: Readonly<{ lab: LogoLab }>) {
  const src = lab.logoVersion === null ? null : labLogoSrc(lab.labId, lab.logoVersion);
  return (
    <section aria-labelledby={HEADING} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id={HEADING} tabIndex={-1} className={FOCUSABLE_HEADING}>
          {m.labs_logo_heading()}
        </h2>
        <p className="text-muted-foreground">{m.labs_logo_description()}</p>
      </div>
      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        <figure className="flex flex-col items-start gap-2">
          <LabLogo src={src} alt={m.labs_logo_alt({ lab: lab.labName })} size="lg" />
          <figcaption className="text-sm text-muted-foreground">
            {src === null ? m.labs_logo_none() : m.labs_logo_current()}
          </figcaption>
          <RemoveLogo lab={lab} />
        </figure>
        <LogoUploadForm lab={lab} />
      </div>
    </section>
  );
}

/**
 * The remove button, shown while the lab has a logo, and its confirmation, which stays mounted
 * when the button goes, so it can close and move focus to the section heading (WCAG 2.4.3).
 */
function RemoveLogo({ lab }: Readonly<{ lab: LogoLab }>) {
  const queryClient = useQueryClient();
  const confirmation = useConfirmation(HEADING);
  const remove = useSimulationAction(
    simulationMutationOptions(
      queryClient,
      useServerFn(removeLabLogoFn),
      simulationActionKeys.removeLabLogo(lab.simulationId),
    ),
    {
      success: () => m.labs_logo_removed({ lab: lab.labName }),
      onDone: confirmation.done,
      onFailed: confirmation.failed,
    },
  );
  return (
    <>
      {lab.logoVersion !== null && (
        <Button
          ref={confirmation.triggerRef}
          type="button"
          variant="outline"
          size="sm"
          disabled={remove.isPending}
          onClick={confirmation.show}
        >
          <Trash2Icon aria-hidden="true" data-icon="inline-start" />
          {m.labs_logo_remove()}
        </Button>
      )}
      <ConfirmDialog
        confirmation={confirmation}
        title={m.labs_logo_remove_title({ lab: lab.labName })}
        body={m.labs_logo_remove_body()}
        confirm={m.labs_logo_remove()}
        pending={remove.isPending}
        onConfirm={() => remove.mutate({ labId: lab.labId })}
      />
    </>
  );
}

function LogoUploadForm({ lab }: Readonly<{ lab: LogoLab }>) {
  const queryClient = useQueryClient();
  const upload = useMutation(
    labLogoUploadMutationOptions(
      queryClient,
      useServerFn(uploadLabLogoFn),
      simulationActionKeys.uploadLabLogo(lab.simulationId),
    ),
  );
  const form = useAppForm({
    defaultValues: DEFAULTS,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: logoFormSchema },
    onSubmit: async ({ value, formApi }) => {
      if (value.file === null) return;
      const data = new FormData();
      data.set(LOGO_FORM_FIELDS.labId, lab.labId);
      data.set(LOGO_FORM_FIELDS.file, value.file);
      let result: Awaited<ReturnType<typeof upload.mutateAsync>>;
      try {
        result = await upload.mutateAsync(data);
      } catch {
        // NOTE: WCAG 3.3.1; a failed request is a refusal at the top of the form, never silent.
        applyServerRefusal(formApi, { form: simulationErrorMessage(null) });
        return;
      }
      if (!result.ok) {
        const { error } = result;
        applyServerRefusal(
          formApi,
          isLogoRefusal(error)
            ? { fields: { file: logoRefusalMessage(error) } }
            : { form: simulationErrorMessage(error) },
        );
        return;
      }
      toast.success(m.labs_logo_uploaded({ lab: lab.labName }));
      formApi.reset();
    },
  });
  return (
    <form
      noValidate
      aria-label={m.labs_logo_form({ lab: lab.labName })}
      className="flex min-w-0 flex-1 flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.AppForm>
        <form.FormErrors />
        <FieldGroup>
          <form.AppField name="file">
            {(field) => (
              <field.FileField
                label={m.labs_logo_field()}
                description={logoFieldHelp()}
                accept={LOGO_MEDIA_TYPES.join(",")}
              />
            )}
          </form.AppField>
        </FieldGroup>
        <ChosenPreview file={useStore(form.store, (state) => state.values.file)} lab={lab} />
        <div>
          <form.SubmitButton icon={<ImageUpIcon aria-hidden="true" data-icon="inline-start" />}>
            {lab.logoVersion === null ? m.labs_logo_upload() : m.labs_logo_replace()}
          </form.SubmitButton>
        </div>
      </form.AppForm>
    </form>
  );
}

/**
 * The chosen file as an image, before it is sent: only a file that passes the browser's own
 * check, read as a `data:` address, which the page's CSP allows for images.
 */
function ChosenPreview({ file, lab }: Readonly<{ file: File | null; lab: LogoLab }>) {
  const [preview, setPreview] = useState<{ file: File; src: string } | null>(null);
  useEffect(() => {
    if (file === null || precheckLogoFile(file) !== null) return;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") setPreview({ file, src: reader.result });
    });
    reader.readAsDataURL(file);
    return () => reader.abort();
  }, [file]);
  if (preview === null || preview.file !== file) return null;
  return (
    <figure className="flex flex-col items-start gap-2">
      <LabLogo src={preview.src} alt={m.labs_logo_preview_alt({ lab: lab.labName })} size="lg" />
      <figcaption className="text-sm text-muted-foreground">{m.labs_logo_preview()}</figcaption>
    </figure>
  );
}
