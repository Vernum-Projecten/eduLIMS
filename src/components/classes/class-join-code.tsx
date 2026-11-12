// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { revalidateLogic } from "@tanstack/react-form";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleOffIcon,
  ClipboardCopyIcon,
  KeyRoundIcon,
  MailIcon,
  PowerOffIcon,
  RefreshCwIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { ConfirmButton } from "@/components/admin-users/admin-action";
import { classLabel } from "@/components/classes/class-name";
import { useClassMutation } from "@/components/classes/use-class-mutation";
import { useAppForm } from "@/components/form/app-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { m } from "@/i18n/messages";
import { classCan } from "@/lib/classes";
import { applyServerRefusal } from "@/lib/forms/server-refusal";
import { classErrorMessage } from "@/lib/i18n/class-labels";
import { formatDateTime, formatNumber } from "@/lib/i18n/format";
import {
  JOIN_CODE_DAYS_DEFAULT,
  JOIN_CODE_DAYS_MAX,
  JOIN_CODE_USES_DEFAULT,
  JOIN_CODE_USES_MAX,
} from "@/lib/join-code";
import {
  disableJoinCodeFn,
  enableJoinCodeFn,
  regenerateJoinCodeFn,
} from "@/server/classes/functions";
import type { NewJoinCode } from "@/server/classes/join-code";
import {
  type ClassPage,
  classErrorCode,
  classMutationOptions,
  type JoinCodeState,
  joinCodeQueryOptions,
} from "@/server/classes/query-options";
import { type JoinCodeForm, joinCodeFormSchema } from "@/server/classes/schemas";

const DEFAULTS: JoinCodeForm = {
  validDays: JOIN_CODE_DAYS_DEFAULT,
  maxUses: JOIN_CODE_USES_DEFAULT,
};

/** The days and uses fields with the form's submit, shared by "turn on" and "new code". */
function JoinCodeSettingsForm({
  submit,
  label,
  onSubmit,
  footer,
}: Readonly<{
  submit: string;
  label: string;
  onSubmit: (value: JoinCodeForm) => Promise<string | null>;
  footer?: (button: ReactNode) => ReactNode;
}>) {
  const form = useAppForm({
    defaultValues: DEFAULTS,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: joinCodeFormSchema },
    onSubmit: async ({ value, formApi }) => {
      const refusal = await onSubmit(value);
      if (refusal) applyServerRefusal(formApi, { form: refusal });
    },
  });
  const button = (
    <form.SubmitButton icon={<KeyRoundIcon aria-hidden="true" data-icon="inline-start" />}>
      {submit}
    </form.SubmitButton>
  );
  return (
    <form
      noValidate
      aria-label={label}
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.AppForm>
        <form.FormErrors />
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          <form.AppField name="validDays">
            {(field) => (
              <field.NumberField
                label={m.classes_join_field_days()}
                description={m.classes_join_field_days_help({
                  max: formatNumber(JOIN_CODE_DAYS_MAX),
                })}
                min={1}
                max={JOIN_CODE_DAYS_MAX}
                step={1}
              />
            )}
          </form.AppField>
          <form.AppField name="maxUses">
            {(field) => (
              <field.NumberField
                label={m.classes_join_field_uses()}
                description={m.classes_join_field_uses_help({
                  max: formatNumber(JOIN_CODE_USES_MAX),
                })}
                min={1}
                max={JOIN_CODE_USES_MAX}
                step={1}
              />
            )}
          </form.AppField>
        </FieldGroup>
        {footer ? footer(button) : <div>{button}</div>}
      </form.AppForm>
    </form>
  );
}

/** Returns the translated text a teacher pastes into an email: the link, the code and its end. */
export function joinInvitationText(
  page: Pick<ClassPage, "name" | "academicYear">,
  fresh: Pick<NewJoinCode, "code" | "expiresAt">,
  origin: string,
): string {
  return m.classes_join_invitation_text({
    class: classLabel({ name: page.name, academicYear: page.academicYear }),
    link: `${origin}/login`,
    code: fresh.code,
    until: formatDateTime(fresh.expiresAt),
  });
}

/** Puts `text` on the clipboard and says so in a toast; no email is sent. */
function copy(text: string, done: string): void {
  navigator.clipboard.writeText(text).then(
    () => toast.success(done),
    () => toast.error(m.classes_join_copy_failed()),
  );
}

/**
 * The new code, shown once, with a button that copies the code and one that copies a ready
 * invitation text with the sign-in link and the code, for an email or a course page.
 */
function FreshCode({ fresh, page }: Readonly<{ fresh: NewJoinCode; page: ClassPage }>) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4">
      <dl className="flex flex-col gap-1">
        <dt className="font-medium">{m.classes_join_new_code()}</dt>
        <dd className="font-mono text-2xl font-semibold tracking-widest break-all">{fresh.code}</dd>
      </dl>
      <p className="text-sm text-muted-foreground">{m.classes_join_shown_once()}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() =>
            copy(
              joinInvitationText(page, fresh, window.location.origin),
              m.classes_invitation_text_copied(),
            )
          }
        >
          <MailIcon aria-hidden="true" data-icon="inline-start" />
          {m.classes_invitation_text_copy()}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => copy(fresh.code, m.classes_join_copied())}
        >
          <ClipboardCopyIcon aria-hidden="true" data-icon="inline-start" />
          {m.classes_join_copy()}
        </Button>
      </div>
    </div>
  );
}

/** One line of the code's state: an icon and its text, never the colour alone (WCAG 1.4.1). */
function CodeStatus({ state }: Readonly<{ state: JoinCodeState }>) {
  if (!state.enabled) {
    return (
      <p className="flex items-center gap-2">
        <CircleOffIcon aria-hidden="true" className="size-4 shrink-0" />
        {m.classes_join_status_off()}
      </p>
    );
  }
  const usedUp = state.uses >= state.maxUses;
  const working = !state.stale && !state.expired && !usedUp;
  const Icon = working ? CircleCheckIcon : CircleAlertIcon;
  const date = formatDateTime(state.expiresAt);
  let text = m.classes_join_status_on({ date });
  if (state.stale) text = m.classes_join_status_stale();
  else if (state.expired) text = m.classes_join_status_expired({ date });
  else if (usedUp) text = m.classes_join_status_used_up();
  return (
    <div className="flex flex-col gap-1">
      <p className="flex items-center gap-2 font-medium">
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        {text}
      </p>
      <p className="text-muted-foreground">
        {m.classes_join_status_uses({
          uses: formatNumber(state.uses),
          max: formatNumber(state.maxUses),
        })}
      </p>
    </div>
  );
}

/** "New code": a dialog with the settings; the old code stops working at once. */
function RegenerateDialog({
  page,
  onFresh,
}: Readonly<{ page: ClassPage; onFresh: (fresh: NewJoinCode) => void }>) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const regenerate = useClassMutation(
    classMutationOptions(queryClient, useServerFn(regenerateJoinCodeFn)),
    () => m.classes_join_regenerated(),
    { inForm: true },
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <RefreshCwIcon aria-hidden="true" data-icon="inline-start" />
          {m.classes_join_regenerate()}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{m.classes_join_regenerate_title()}</DialogTitle>
          <DialogDescription>{m.classes_join_regenerate_description()}</DialogDescription>
        </DialogHeader>
        <JoinCodeSettingsForm
          label={m.classes_join_regenerate_title()}
          submit={m.classes_join_regenerate_submit()}
          onSubmit={async (value) => {
            try {
              onFresh(await regenerate.mutateAsync({ classId: page.id, ...value }));
              setOpen(false);
              return null;
            } catch (error) {
              return classErrorMessage(classErrorCode(error));
            }
          }}
          footer={(button) => (
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {m.classes_cancel()}
                </Button>
              </DialogClose>
              {button}
            </DialogFooter>
          )}
        />
      </DialogContent>
    </Dialog>
  );
}

/**
 * The join code of a class (#49) on the invitations tab: off by default; an owner or co-teacher
 * turns it on with a term and a number of uses, makes a new one, or turns it off. The code is
 * shown once, when it is made: the server keeps only its hash.
 */
export function ClassJoinCode({ page }: Readonly<{ page: ClassPage }>) {
  const { data: state } = useSuspenseQuery(joinCodeQueryOptions(page.id));
  const queryClient = useQueryClient();
  const [fresh, setFresh] = useState<NewJoinCode | null>(null);
  const enable = useClassMutation(
    classMutationOptions(queryClient, useServerFn(enableJoinCodeFn)),
    () => m.classes_join_enabled(),
    { inForm: true },
  );
  const disable = useClassMutation(
    classMutationOptions(queryClient, useServerFn(disableJoinCodeFn)),
    () => m.classes_join_disabled(),
  );
  const archived = page.archivedAt !== null;
  const canManage = !archived && classCan(page.myRole, { student: ["invite"] });
  return (
    <section aria-labelledby="join-code-heading" className="flex flex-col gap-4">
      <h3 id="join-code-heading" className="text-lg font-semibold">
        {m.classes_join_title()}
      </h3>
      <p className="text-muted-foreground">{m.classes_join_description()}</p>
      <CodeStatus state={state} />
      {archived && <p className="text-muted-foreground">{m.classes_join_archived()}</p>}
      {canManage && state.enabled && fresh && <FreshCode fresh={fresh} page={page} />}
      {canManage && !state.enabled && (
        <JoinCodeSettingsForm
          label={m.classes_join_title()}
          submit={m.classes_join_enable()}
          onSubmit={async (value) => {
            try {
              setFresh(await enable.mutateAsync({ classId: page.id, ...value }));
              return null;
            } catch (error) {
              return classErrorMessage(classErrorCode(error));
            }
          }}
        />
      )}
      {canManage && state.enabled && (
        <div className="flex flex-wrap gap-2">
          <RegenerateDialog page={page} onFresh={setFresh} />
          <ConfirmButton
            icon={PowerOffIcon}
            label={m.classes_join_disable()}
            title={m.classes_join_disable_title()}
            description={m.classes_join_disable_description()}
            confirm={m.classes_join_disable_confirm()}
            destructive
            pending={disable.isPending}
            onConfirm={() =>
              disable.mutate({ classId: page.id }, { onSuccess: () => setFresh(null) })
            }
          />
        </div>
      )}
    </section>
  );
}
