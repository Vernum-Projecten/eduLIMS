// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { type MouseEvent, useRef, useState } from "react";
import type { DialogControl } from "@/components/simulations/name-dialog";

/** The dialog of a record: open or not, and the record it corrects (none for a new one). */
interface DialogState<T> {
  open: boolean;
  row: T | undefined;
  /**
   * The dialog's React key: new on every open, so each open starts from the record as it is now
   * (a second correction shows the first one saved); the same while it closes, so the closing
   * dialog never remounts.
   */
  key: string;
}

/**
 * The state of a record's dialog with its focus return (WCAG 2.4.3): the element that opened it
 * takes the focus back when it closes, by Escape, Cancel or a save. The dialog has no
 * `DialogTrigger`, so Radix would otherwise focus nothing.
 */
export function useRecordDialog<T extends { id: string }>() {
  const opener = useRef<HTMLElement | null>(null);
  const opens = useRef(0);
  const [state, setState] = useState<DialogState<T>>({ open: false, row: undefined, key: "0" });
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
  function open(element: HTMLElement | null, row: T | undefined) {
    opener.current = element;
    opens.current += 1;
    setState({ open: true, row, key: String(opens.current) });
  }
  return {
    control,
    row: state.row,
    key: state.key,
    /** The element focus returns to when the dialog closes. */
    opener: () => opener.current,
    /** Opens the dialog from the button `event` came from, for `row` or for a new record. */
    openFrom(event: MouseEvent<HTMLButtonElement>, row?: T) {
      open(event.currentTarget, row);
    },
    /**
     * Opens the dialog for `row` with focus returning to `element`: a menu item's own button, or
     * the opener of a sheet the dialog replaces, since neither the menu nor the sheet is there
     * when the dialog closes.
     */
    openWith(element: HTMLElement | null, row: T) {
      open(element, row);
    },
  };
}
