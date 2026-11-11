// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { ArrowDownIcon, ArrowUpIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { m } from "@/i18n/messages";
import { controlAfterMove, type RowControl } from "@/lib/forms/array-move";

/** Returns the id of a row's control, so focus can follow the row after a move. */
export function rowControlId(rowKey: string, control: RowControl): string {
  return `${rowKey}-${control}`;
}

/**
 * The editing state of an array editor (rows that are added, removed and reordered): what the
 * live region announces, and the element that takes focus after the next render.
 */
export function useArrayEditing() {
  const [announcement, setAnnouncement] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);
  useEffect(() => {
    if (focusId === null) return;
    document.getElementById(focusId)?.focus();
    setFocusId(null);
  }, [focusId]);

  return {
    announcement,
    announce: setAnnouncement,
    focus: setFocusId,
    /** Announces a move from `from` to `to` and keeps focus on the moved row's control. */
    moved(rowKey: string, item: string, from: number, to: number, count: number) {
      setAnnouncement(m.form_array_moved({ item, position: String(to + 1), count: String(count) }));
      setFocusId(rowControlId(rowKey, controlAfterMove(to, count, to < from ? "up" : "down")));
    },
  };
}

/** The live region of an array editor; it is always present, so every change is announced. */
export function ArrayAnnouncer({ announcement }: Readonly<{ announcement: string }>) {
  return (
    <p role="status" className="sr-only">
      {announcement}
    </p>
  );
}

/**
 * Move up, move down and remove for one row of an array editor, named after the row (`item`),
 * so a screen reader hears "Move Accuracy up" and not three anonymous icons.
 */
export function ArrayRowControls({
  rowKey,
  item,
  index,
  count,
  onMove,
  onRemove,
}: Readonly<{
  rowKey: string;
  item: string;
  index: number;
  count: number;
  onMove: (to: number) => void;
  onRemove: () => void;
}>) {
  return (
    <div className="flex shrink-0 gap-1">
      <Button
        id={rowControlId(rowKey, "up")}
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label={m.form_array_move_up({ item })}
        disabled={index === 0}
        onClick={() => onMove(index - 1)}
      >
        <ArrowUpIcon aria-hidden="true" />
      </Button>
      <Button
        id={rowControlId(rowKey, "down")}
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label={m.form_array_move_down({ item })}
        disabled={index >= count - 1}
        onClick={() => onMove(index + 1)}
      >
        <ArrowDownIcon aria-hidden="true" />
      </Button>
      <Button
        id={rowControlId(rowKey, "remove")}
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label={m.form_array_remove({ item })}
        onClick={onRemove}
      >
        <Trash2Icon aria-hidden="true" />
      </Button>
    </div>
  );
}
