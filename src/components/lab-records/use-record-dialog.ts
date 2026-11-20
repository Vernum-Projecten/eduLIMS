// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { type MouseEvent, useRef, useState } from "react";
import type { DialogControl } from "@/components/simulations/name-dialog";

/** The dialog of a record: open or not, and the record it corrects (none for a new one). */
interface DialogState<T> {
  open: boolean;
  row: T | undefined;
  /** The dialog's React key: it stays the same while the dialog closes, so it never remounts. */
  key: string;
}

/**
 * The state of a record's dialog with its focus return (WCAG 2.4.3): the button that opened it
 * takes the focus back when it closes, by Escape, Cancel or a save. The dialog has no
 * `DialogTrigger`, so Radix would otherwise focus nothing.
 */
export function useRecordDialog<T extends { id: string }>() {
  const opener = useRef<HTMLElement | null>(null);
  const [state, setState] = useState<DialogState<T>>({ open: false, row: undefined, key: "new" });
  const control: DialogControl = {
    open: state.open,
    onOpenChange: (open) => {
      if (!open) setState((current) => ({ ...current, open: false }));
    },
    onCloseAutoFocus: (event) => {
      event.preventDefault();
      opener.current?.focus();
    },
  };
  return {
    control,
    row: state.row,
    key: state.key,
    /** Opens the dialog from the button `event` came from, for `row` or for a new record. */
    openFrom(event: MouseEvent<HTMLButtonElement>, row?: T) {
      opener.current = event.currentTarget;
      setState({ open: true, row, key: row ? row.id : "new" });
    },
    /**
     * Opens the dialog for `row` from a menu item: focus returns to `opener`, the menu's button,
     * because the menu is gone when the dialog closes.
     */
    openWith(element: HTMLElement | null, row: T) {
      opener.current = element;
      setState({ open: true, row, key: row.id });
    },
  };
}
