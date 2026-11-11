// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleHelpIcon,
  CircleXIcon,
  DatabaseIcon,
  type LucideIcon,
  NetworkIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
} from "lucide-react";
import { toast } from "sonner";
import { UpdatingIndicator } from "@/components/shell/updating-indicator";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { m } from "@/i18n/messages";
import {
  checkErrorLabel,
  integrationDescription,
  integrationLabel,
  integrationStateLabel,
} from "@/lib/i18n/analyser-labels";
import { formatDateTime, formatNumber, formatRelativeTime } from "@/lib/i18n/format";
import type { Integration, IntegrationDisplayState } from "@/lib/integrations";
import { cn } from "@/lib/utils";
import { checkIntegrationsNow } from "@/server/integrations/functions";
import { checkNowMutationOptions } from "@/server/integrations/query-options";
import type { IntegrationStatus, IntegrationStatusPage } from "@/server/integrations/store";

const INTEGRATION_ICONS: Record<Integration, LucideIcon> = {
  ferroehr: DatabaseIcon,
  ferrobridge: NetworkIcon,
};

/** The icon of each state, always beside its text (WCAG 1.4.1). */
const STATE_ICONS: Record<IntegrationDisplayState, LucideIcon> = {
  available: CircleCheckIcon,
  unavailable: CircleXIcon,
  refused: ShieldAlertIcon,
  unknown: CircleHelpIcon,
  not_checked: CircleDashedIcon,
};

const STATE_CLASSES: Record<IntegrationDisplayState, string> = {
  available: "border-border text-foreground",
  unavailable: "border-destructive/40 bg-destructive/10 text-destructive",
  refused: "border-destructive/40 bg-background text-foreground",
  unknown: "border-border bg-muted text-foreground",
  not_checked: "border-border bg-muted text-foreground",
};

function StateText({ state }: Readonly<{ state: IntegrationDisplayState }>) {
  const Icon = STATE_ICONS[state];
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-md border px-2 py-1 font-medium",
        STATE_CLASSES[state],
      )}
    >
      <Icon aria-hidden="true" className="size-4" />
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

function IntegrationCard({
  status,
  readAt,
}: Readonly<{ status: IntegrationStatus; readAt: string }>) {
  const Icon = INTEGRATION_ICONS[status.integration];
  const name = integrationLabel(status.integration);
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
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <StateText state={status.state} />
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <div className="flex flex-col gap-0.5">
            <dt className="text-sm text-muted-foreground">{m.admin_integrations_last_check()}</dt>
            <dd>
              <When value={status.checkedAt} readAt={readAt} />
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-sm text-muted-foreground">{m.admin_integrations_last_success()}</dt>
            <dd>
              <When value={status.lastSuccessAt} readAt={readAt} />
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-sm text-muted-foreground">
              {m.admin_integrations_response_time()}
            </dt>
            <dd>
              {status.responseTimeMs === null ? (
                <span className="text-muted-foreground">{m.admin_integrations_no_response()}</span>
              ) : (
                m.admin_integrations_milliseconds({ ms: formatNumber(status.responseTimeMs) })
              )}
            </dd>
          </div>
          {status.errorClass && (
            <div className="flex flex-col gap-0.5">
              <dt className="text-sm text-muted-foreground">{m.admin_integrations_reason()}</dt>
              <dd>{checkErrorLabel(status.errorClass)}</dd>
            </div>
          )}
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

/**
 * The integration status (B3, #35): FerroEHR and FerroBRIDGE, each with its state as an icon
 * and text, the last check, the last success, the response time and, after a failure, its
 * reason. "Check now" runs the check at once; the screen also refetches in the background and
 * shows "Updating…" meanwhile. A state change is announced through a live region (WCAG 4.1.3).
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
      <p role="status" className="sr-only">
        {summary(page)}
      </p>
      <div className="relative" aria-busy={busy || undefined}>
        <UpdatingIndicator active={busy} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {page.integrations.map((status) => (
            <IntegrationCard key={status.integration} status={status} readAt={page.readAt} />
          ))}
        </div>
      </div>
    </div>
  );
}
