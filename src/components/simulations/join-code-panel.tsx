// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleOffIcon,
  ClipboardCopyIcon,
  EyeOffIcon,
  PowerOffIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { simulationActionKeys } from "@/components/simulations/action-keys";
import { ConfirmDialog, useConfirmation } from "@/components/simulations/confirm-dialog";
import { FOCUSABLE_HEADING, focusById } from "@/components/simulations/focus";
import { JoinCodeSettingsForm } from "@/components/simulations/join-code-settings";
import { useSimulationAction } from "@/components/simulations/use-simulation-action";
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
import { m } from "@/i18n/messages";
import { formatDateTime, formatNumber } from "@/lib/i18n/format";
import {
  disableJoinCodeFn,
  enableJoinCodeFn,
  regenerateJoinCodeFn,
} from "@/server/simulations/functions";
import type { JoinCodeView, NewJoinCode } from "@/server/simulations/join-code";
import {
  joinCodeQueryOptions,
  simulationMutationOptions,
} from "@/server/simulations/query-options";

const HEADING = "join-code-heading";
const FRESH = "join-code-fresh";

/** One line of the code's state: an icon and its text, never the colour alone (WCAG 1.4.1). */
function CodeStatus({ state }: Readonly<{ state: JoinCodeView }>) {
  if (!state.enabled) {
    return (
      <p className="flex items-start gap-2 font-medium">
        <CircleOffIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {m.labs_code_status_off()}
      </p>
    );
  }
  const usedUp = state.uses >= state.maxUses;
  const working = !state.stale && !state.expired && !usedUp;
  const Icon = working ? CircleCheckIcon : CircleAlertIcon;
  const date = formatDateTime(state.expiresAt);
  let text = m.labs_code_status_on({ date });
  if (state.stale) text = m.labs_code_status_stale();
  else if (state.expired) text = m.labs_code_status_expired({ date });
  else if (usedUp) text = m.labs_code_status_used_up();
  return (
    <div className="flex flex-col gap-1">
      <p className="flex items-start gap-2 font-medium">
        <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {text}
      </p>
      <p className="text-muted-foreground">
        {m.labs_code_status_uses({
          uses: formatNumber(state.uses),
          max: formatNumber(state.maxUses),
        })}
      </p>
    </div>
  );
}

/** What a copy did, for the code it copied. */
interface CopyResult {
  code: string;
  ok: boolean;
}

/**
 * The new code, shown once (the server keeps only its hash), with a copy button whose outcome is
 * a status message (WCAG 4.1.3). It takes focus when it appears, so the teacher lands on it.
 */
function FreshCode({ fresh }: Readonly<{ fresh: NewJoinCode }>) {
  const [copied, setCopied] = useState<CopyResult | null>(null);
  const result = copied?.code === fresh.code ? copied : null;
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4">
      <h3 id={FRESH} tabIndex={-1} className={FOCUSABLE_HEADING}>
        {m.labs_code_new()}
      </h3>
      <p className="font-mono text-2xl font-semibold tracking-widest break-all">{fresh.code}</p>
      <p className="text-muted-foreground">{m.labs_code_shown_once()}</p>
      <div>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            navigator.clipboard.writeText(fresh.code).then(
              () => setCopied({ code: fresh.code, ok: true }),
              () => setCopied({ code: fresh.code, ok: false }),
            );
          }}
        >
          <ClipboardCopyIcon aria-hidden="true" data-icon="inline-start" />
          {m.labs_code_copy()}
        </Button>
      </div>
      <p role="status" className="min-h-6">
        {result && (result.ok ? m.labs_code_copied() : m.labs_code_copy_failed())}
      </p>
    </div>
  );
}

/**
 * The lab code on the teacher's lab page (S10, #288): off until a teacher turns it on with a
 * term and a number of joins. The code shows once, in the answer that made it; after that the
 * panel says it is no longer shown. Making a new code and turning it off each ask first.
 */
export function JoinCodePanel({
  simulationId,
  labId,
  labName,
}: Readonly<{ simulationId: string; labId: string; labName: string }>) {
  const { data: state } = useSuspenseQuery(joinCodeQueryOptions(simulationId, labId));
  const queryClient = useQueryClient();
  const regenerateDialog = useConfirmation(FRESH);
  const disableDialog = useConfirmation(HEADING);
  const enable = useSimulationAction(
    simulationMutationOptions(
      queryClient,
      useServerFn(enableJoinCodeFn),
      simulationActionKeys.enableJoinCode(simulationId, labId),
    ),
    { success: () => m.labs_code_enabled(), toastErrors: false },
  );
  const regenerate = useSimulationAction(
    simulationMutationOptions(
      queryClient,
      useServerFn(regenerateJoinCodeFn),
      simulationActionKeys.regenerateJoinCode(simulationId, labId),
    ),
    {
      success: () => m.labs_code_regenerated(),
      toastErrors: false,
      onDone: regenerateDialog.done,
    },
  );
  const disable = useSimulationAction(
    simulationMutationOptions(
      queryClient,
      useServerFn(disableJoinCodeFn),
      simulationActionKeys.disableJoinCode(simulationId, labId),
    ),
    {
      success: () => m.labs_code_disabled(),
      onDone: () => {
        enable.reset();
        regenerate.reset();
        disableDialog.done();
      },
      onFailed: disableDialog.failed,
    },
  );

  // The latest code made on this page; the server keeps only its hash, so a reload loses it.
  const fresh =
    regenerate.data && (!enable.data || regenerate.submittedAt > enable.submittedAt)
      ? regenerate.data
      : (enable.data ?? null);
  const making = enable.isPending || regenerate.isPending;

  useEffect(() => {
    if (fresh) focusById(FRESH);
  }, [fresh]);

  return (
    <section aria-labelledby={HEADING} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id={HEADING} tabIndex={-1} className={FOCUSABLE_HEADING}>
          {m.labs_code_heading()}
        </h2>
        <p className="text-muted-foreground">{m.labs_code_description()}</p>
      </div>
      <div className="flex flex-col gap-4 rounded-lg border p-4">
        <CodeStatus state={state} />
        {!state.enabled && (
          <JoinCodeSettingsForm
            label={m.labs_code_form()}
            submit={m.labs_code_enable()}
            save={(value) => enable.mutateAsync({ labId, ...value })}
          />
        )}
        {state.enabled && fresh && <FreshCode fresh={fresh} />}
        {state.enabled && !fresh && !making && (
          <p className="flex items-start gap-2">
            <EyeOffIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {m.labs_code_hidden()}
          </p>
        )}
        {state.enabled && (
          <div className="flex flex-wrap gap-2">
            <Button
              ref={regenerateDialog.triggerRef}
              type="button"
              variant="outline"
              onClick={regenerateDialog.show}
            >
              <RefreshCwIcon aria-hidden="true" data-icon="inline-start" />
              {m.labs_code_regenerate()}
            </Button>
            <Button
              ref={disableDialog.triggerRef}
              type="button"
              variant="outline"
              disabled={disable.isPending}
              onClick={disableDialog.show}
            >
              <PowerOffIcon aria-hidden="true" data-icon="inline-start" />
              {m.labs_code_disable()}
            </Button>
          </div>
        )}
      </div>
      <Dialog
        open={regenerateDialog.control.open}
        onOpenChange={regenerateDialog.control.onOpenChange}
      >
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md"
          onCloseAutoFocus={regenerateDialog.control.onCloseAutoFocus}
        >
          <DialogHeader>
            <DialogTitle>{m.labs_code_regenerate_title({ lab: labName })}</DialogTitle>
            <DialogDescription>{m.labs_code_regenerate_description()}</DialogDescription>
          </DialogHeader>
          <JoinCodeSettingsForm
            label={m.labs_code_regenerate_title({ lab: labName })}
            submit={m.labs_code_regenerate_submit()}
            save={(value) => regenerate.mutateAsync({ labId, ...value })}
            footer={(button) => (
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline">
                    {m.simulations_cancel()}
                  </Button>
                </DialogClose>
                {button}
              </DialogFooter>
            )}
          />
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        confirmation={disableDialog}
        title={m.labs_code_disable_title({ lab: labName })}
        body={m.labs_code_disable_body()}
        confirm={m.labs_code_disable_confirm()}
        pending={disable.isPending}
        onConfirm={() => disable.mutate({ labId })}
      />
    </section>
  );
}
