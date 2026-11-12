// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleHelpIcon,
  CircleMinusIcon,
  CircleXIcon,
  DatabaseIcon,
  FileQuestionIcon,
  type LucideIcon,
  NetworkIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { m } from "@/i18n/messages";
import {
  checkErrorLabel,
  ferroEhrStepLabel,
  integrationDescription,
  integrationLabel,
  integrationStateLabel,
  readinessPhaseLabel,
  signInTargetLabel,
  stepStateLabel,
} from "@/lib/i18n/analyser-labels";
import { formatDateTime, formatNumber, formatRelativeTime } from "@/lib/i18n/format";
import {
  FERROEHR_STEPS,
  type FerroBridgeDetail,
  type FerroEhrDetail,
  type Integration,
  type IntegrationDisplayState,
  type StepState,
} from "@/lib/integrations";
import { cn } from "@/lib/utils";
import { checkIntegrationsNow } from "@/server/integrations/functions";
import { checkNowMutationOptions } from "@/server/integrations/query-options";
import type { IntegrationStatus, IntegrationStatusPage } from "@/server/integrations/store";

/** The icon of each integration. */
export const INTEGRATION_ICONS: Record<Integration, LucideIcon> = {
  ferroehr: DatabaseIcon,
  ferrobridge: NetworkIcon,
};

/** The icon of each state, always beside its text (WCAG 1.4.1). */
const STATE_ICONS: Record<IntegrationDisplayState, LucideIcon> = {
  available: CircleCheckIcon,
  unavailable: CircleXIcon,
  refused: ShieldAlertIcon,
  not_ready: CircleAlertIcon,
  unknown: CircleHelpIcon,
  not_checked: CircleDashedIcon,
};

const STATE_CLASSES: Record<IntegrationDisplayState, string> = {
  available: "border-border text-foreground",
  unavailable: "border-destructive/40 bg-destructive/10 text-destructive",
  refused: "border-destructive/40 bg-background text-foreground",
  not_ready: "border-destructive/40 bg-background text-foreground",
  unknown: "border-border bg-muted text-foreground",
  not_checked: "border-border bg-muted text-foreground",
};

/** The icon of each step outcome, always beside its text (WCAG 1.4.1). */
const STEP_ICONS: Record<StepState, LucideIcon> = {
  passed: CircleCheckIcon,
  failed: CircleXIcon,
  refused: ShieldAlertIcon,
  missing: FileQuestionIcon,
  skipped: CircleMinusIcon,
};

/** The state of an integration as an icon and text, never colour alone (WCAG 1.4.1). */
export function IntegrationStateText({
  state,
  className,
}: Readonly<{ state: IntegrationDisplayState; className?: string }>) {
  const Icon = STATE_ICONS[state];
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-md border px-2 py-1 font-medium",
        STATE_CLASSES[state],
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      {integrationStateLabel(state)}
    </span>
  );
}

function When({ value, readAt }: Readonly<{ value: string | null; readAt: string }>) {
  if (!value) return <span className="text-muted-foreground">{m.admin_integrations_never()}</span>;
  return (
    <span className="flex flex-col">
      <time dateTime={value}>{formatRelativeTime(value, readAt)}</time>
      <span className="text-muted-foreground">{formatDateTime(value)}</span>
    </span>
  );
}

function Item({ term, children }: Readonly<{ term: string; children: ReactNode }>) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-sm text-muted-foreground">{term}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

function NotStated() {
  return <span className="text-muted-foreground">{m.admin_integrations_version_not_stated()}</span>;
}

/** FerroEHR's three steps, each with an icon and text (#227, WCAG 1.4.1). */
function FerroEhrSteps({ detail }: Readonly<{ detail: FerroEhrDetail }>) {
  return (
    <ul aria-label={m.admin_integrations_steps()} className="flex flex-col gap-2">
      {FERROEHR_STEPS.map((step) => {
        const state = detail.steps[step];
        const Icon = STEP_ICONS[state];
        return (
          <li
            key={step}
            className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
          >
            <span className="font-medium">{ferroEhrStepLabel(step)}</span>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 text-sm",
                state === "failed" || state === "refused"
                  ? "text-destructive"
                  : "text-muted-foreground",
              )}
            >
              <Icon aria-hidden="true" className="size-4 shrink-0" />
              {stepStateLabel(state)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function FerroEhrItems({ detail }: Readonly<{ detail: FerroEhrDetail }>) {
  return (
    <>
      <Item term={m.admin_integrations_server_version()}>
        {detail.serverVersion ?? <NotStated />}
      </Item>
      <Item term={m.admin_integrations_spec_version()}>{detail.specVersion ?? <NotStated />}</Item>
      {detail.signInTarget && (
        <Item term={m.admin_integrations_sign_in_target()}>
          {signInTargetLabel(detail.signInTarget)}
        </Item>
      )}
      {detail.authReason && (
        <Item term={m.admin_integrations_auth_reason()}>
          <code className="font-mono text-sm">{detail.authReason}</code>
        </Item>
      )}
    </>
  );
}

function FerroBridgeItems({ detail }: Readonly<{ detail: FerroBridgeDetail }>) {
  return (
    <>
      {detail.phase && detail.phase !== "serving" && (
        <Item term={m.admin_integrations_phase()}>{readinessPhaseLabel(detail.phase)}</Item>
      )}
      <Item term={m.admin_integrations_failing_indicators()}>
        {detail.failingIndicators.length === 0 ? (
          <span className="text-muted-foreground">
            {m.admin_integrations_no_failing_indicators()}
          </span>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {detail.failingIndicators.map((name) => (
              <li key={name}>
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">{name}</code>
              </li>
            ))}
          </ul>
        )}
      </Item>
    </>
  );
}

function IntegrationCard({
  status,
  readAt,
}: Readonly<{ status: IntegrationStatus; readAt: string }>) {
  const Icon = INTEGRATION_ICONS[status.integration];
  const name = integrationLabel(status.integration);
  const bridge = status.errorClass === "readiness_down" ? status.ferrobridge : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <Icon aria-hidden="true" className="size-5 text-muted-foreground" />
            {name}
          </h3>
        </CardTitle>
        <CardDescription>{integrationDescription(status.integration)}</CardDescription>
        <CardAction>
          <IntegrationStateText state={status.state} className="text-sm" />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {status.ferroehr && <FerroEhrSteps detail={status.ferroehr} />}
        {status.errorClass && <p className="text-sm">{checkErrorLabel(status.errorClass)}</p>}
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <Item term={m.admin_integrations_last_check()}>
            <When value={status.checkedAt} readAt={readAt} />
          </Item>
          <Item term={m.admin_integrations_last_success()}>
            <When value={status.lastSuccessAt} readAt={readAt} />
          </Item>
          <Item term={m.admin_integrations_response_time()}>
            {status.responseTimeMs === null ? (
              <span className="text-muted-foreground">{m.admin_integrations_no_response()}</span>
            ) : (
              m.admin_integrations_milliseconds({ ms: formatNumber(status.responseTimeMs) })
            )}
          </Item>
          {status.ferroehr && <FerroEhrItems detail={status.ferroehr} />}
          {bridge && <FerroBridgeItems detail={bridge} />}
        </dl>
      </CardContent>
    </Card>
  );
}

/** The one-line summary a screen reader hears when a state changes. */
function summary(page: IntegrationStatusPage): string {
  return page.integrations
    .map((status) =>
      m.admin_integrations_summary_item({
        name: integrationLabel(status.integration),
        state: integrationStateLabel(status.state),
      }),
    )
    .join(" ");
}

/** Returns the newest check of the page, or `null` before the first one. */
function newestCheck(page: IntegrationStatusPage): string | null {
  const instants = page.integrations.flatMap((status) => status.checkedAt ?? []);
  return instants.toSorted().at(-1) ?? null;
}

/**
 * The quiet status beside "Check now": when the last check ran, or "Updating…" with a spinner
 * during a refetch. It keeps a fixed minimum width, so nothing shifts; it is not a live region,
 * since the panel's `role="status"` summary announces a change of state (WCAG 4.1.3).
 */
function CheckStatus({ page, busy }: Readonly<{ page: IntegrationStatusPage; busy: boolean }>) {
  const newest = newestCheck(page);
  return (
    <span
      data-slot="check-status"
      className="inline-flex min-w-48 items-center gap-1.5 text-sm text-muted-foreground sm:justify-end"
    >
      {busy ? (
        <>
          <Spinner aria-hidden="true" className="size-3.5 motion-reduce:animate-none" />
          {m.admin_integrations_updating()}
        </>
      ) : newest ? (
        <time dateTime={newest}>
          {m.admin_integrations_checked_ago({ when: formatRelativeTime(newest, page.readAt) })}
        </time>
      ) : (
        integrationStateLabel("not_checked")
      )}
    </span>
  );
}

/**
 * The integration status (B3, #35, #227): FerroEHR with its three steps (reachable, signed in,
 * template loaded) and its versions, and FerroBRIDGE with its readiness, each with its state as
 * an icon and text on the card's title row. "Check now" runs the check at once; the screen also
 * refetches in the background, shown beside the button. A change of state is announced through
 * a live region (WCAG 4.1.3).
 */
export function IntegrationStatusPanel({
  page,
  fetching,
  headingId,
}: Readonly<{ page: IntegrationStatusPage; fetching: boolean; headingId: string }>) {
  const queryClient = useQueryClient();
  const call = useServerFn(checkIntegrationsNow);
  const options = checkNowMutationOptions(queryClient, call);
  const check = useMutation({
    ...options,
    onSuccess: async (...args) => {
      await options.onSuccess?.(...args);
      toast.success(m.admin_integrations_checked());
    },
    onError: async (...args) => {
      await options.onError?.(...args);
      toast.error(m.admin_integrations_check_failed());
    },
  });
  const busy = fetching || check.isPending;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 id={headingId} className="text-lg font-semibold">
            {m.admin_integrations_heading()}
          </h2>
          <p className="text-muted-foreground">{m.admin_integrations_description()}</p>
        </div>
        <div className="flex flex-col-reverse items-start gap-2 sm:flex-row sm:items-center">
          <CheckStatus page={page} busy={busy} />
          <Button
            variant="outline"
            disabled={check.isPending}
            aria-busy={check.isPending}
            onClick={() => check.mutate()}
          >
            <RefreshCwIcon
              aria-hidden="true"
              data-icon="inline-start"
              className={cn(check.isPending && "animate-spin motion-reduce:animate-none")}
            />
            {m.admin_integrations_check_now()}
          </Button>
        </div>
      </div>
      <p role="status" className="sr-only">
        {summary(page)}
      </p>
      <div aria-busy={busy || undefined} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {page.integrations.map((status) => (
          <IntegrationCard key={status.integration} status={status} readAt={page.readAt} />
        ))}
      </div>
    </div>
  );
}
