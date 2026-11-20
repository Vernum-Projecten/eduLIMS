// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleHelpIcon,
  CircleXIcon,
  FlaskConicalIcon,
  type LucideIcon,
  TriangleAlertIcon,
} from "lucide-react";
import type { AccuracyStatus } from "@/lib/dashboard";
import type { BoardCell } from "@/lib/dashboard-board";

/** How a cell looks: its icon and its theme classes. Never colour alone (WCAG 1.4.1, Q-ACC-2). */
export interface CellLook {
  icon: LucideIcon;
  className: string;
}

/** The icon and the text colour of each accuracy status (G-03). */
export const STATUS_MARK: Record<AccuracyStatus, { icon: LucideIcon; text: string }> = {
  green: { icon: CircleCheckIcon, text: "text-accuracy-green" },
  yellow: { icon: TriangleAlertIcon, text: "text-accuracy-yellow" },
  red: { icon: CircleXIcon, text: "text-accuracy-red" },
};

const STATUS_CELL: Record<AccuracyStatus, string> = {
  green: "bg-accuracy-green-surface text-accuracy-green",
  yellow: "bg-accuracy-yellow-surface text-accuracy-yellow",
  red: "bg-accuracy-red-surface text-accuracy-red",
};

const NEUTRAL = "bg-muted/50 text-muted-foreground";

/** Returns the look of a board cell: a status colour for a released value, neutral otherwise. */
export function cellLook(cell: BoardCell | undefined): CellLook {
  if (cell === undefined) return { icon: CircleDashedIcon, className: "text-muted-foreground" };
  if (cell.state === "released") {
    if (cell.status === null) return { icon: CircleHelpIcon, className: NEUTRAL };
    return { icon: STATUS_MARK[cell.status].icon, className: STATUS_CELL[cell.status] };
  }
  return {
    icon: cell.state === "measured" ? FlaskConicalIcon : CircleDashedIcon,
    className: NEUTRAL,
  };
}
