// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Link } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
import {
  INTEGRATION_ICONS,
  IntegrationStateText,
} from "@/components/admin-integrations/integration-status";
import { UpdatingIndicator } from "@/components/shell/updating-indicator";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { m } from "@/i18n/messages";
import { integrationLabel, integrationStateLabel } from "@/lib/i18n/analyser-labels";
import { formatRelativeTime } from "@/lib/i18n/format";
import type { IntegrationStatusPage } from "@/server/integrations/store";

/**
 * The integration tiles of the overview (#36, B3): each integration's state as an icon and text
 * and the time of its last check, linking to Analysers and integrations. A state change is
 * announced through a live region (WCAG 4.1.3), as on that screen.
 */
export function IntegrationTiles({
  page,
  fetching,
}: Readonly<{ page: IntegrationStatusPage; fetching: boolean }>) {
  return (
    <div className="relative" aria-busy={fetching || undefined}>
      <UpdatingIndicator active={fetching} />
      <p role="status" className="sr-only">
        {page.integrations
          .map((status) =>
            m.admin_integrations_summary_item({
              name: integrationLabel(status.integration),
              state: integrationStateLabel(status.state),
            }),
          )
          .join(" ")}
      </p>
      <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {page.integrations.map((status) => {
          const Icon = INTEGRATION_ICONS[status.integration];
          return (
            <li key={status.integration} className="flex">
              <Card className="relative w-full gap-3 transition-colors focus-within:ring-3 focus-within:ring-ring/50 hover:bg-accent/50">
                <CardHeader>
                  <CardTitle>
                    <h3 className="flex items-center gap-2 text-base font-semibold">
                      <Icon aria-hidden="true" className="size-5 text-muted-foreground" />
                      <Link
                        to="/admin/integrations"
                        className="outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:underline"
                      >
                        {integrationLabel(status.integration)}
                      </Link>
                    </h3>
                  </CardTitle>
                  <CardAction>
                    <ArrowRightIcon aria-hidden="true" className="size-4 text-muted-foreground" />
                  </CardAction>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  <IntegrationStateText state={status.state} />
                  {status.checkedAt && (
                    <p className="text-sm text-muted-foreground">
                      {m.admin_integrations_last_check()}:{" "}
                      <time dateTime={status.checkedAt}>
                        {formatRelativeTime(status.checkedAt, page.readAt)}
                      </time>
                    </p>
                  )}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
