// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { m } from "@/i18n/messages";
import { formatDateTime } from "@/lib/i18n/format";

/** A cell with an instant in the active locale and the app's time zone, on one line. */
export function DateTimeCell({ value }: Readonly<{ value: string }>) {
  return (
    <time dateTime={value} className="whitespace-nowrap">
      {formatDateTime(value)}
    </time>
  );
}

/**
 * The settings of a row's actions column: always shown, narrow, named for screen readers only.
 * Spread it into `helper.display` and add the cell.
 */
export const ACTIONS_COLUMN = {
  id: "actions",
  enableHiding: false,
  meta: { label: () => m.data_table_actions(), className: "w-12" },
  header: () => <span className="sr-only">{m.data_table_actions()}</span>,
} as const;
