// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { CopyIcon } from "lucide-react";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { m } from "@/i18n/messages";
import { formatLabNumber } from "@/lib/lab-number";

/** Announces a short message in the page's one status region (WCAG 4.1.3). */
type Announce = (message: string) => void;

const AnnounceContext = createContext<Announce | null>(null);

/**
 * The status region of the records page: always in the DOM, so a screen reader hears each copy
 * without the focus moving (WCAG 4.1.3). It is visible, so a sighted user sees it too.
 */
export function CopyAnnouncer({ children }: Readonly<{ children: ReactNode }>) {
  const [message, setMessage] = useState({ text: "", count: 0 });
  const announce = useCallback((text: string) => {
    setMessage((current) => ({ text, count: current.count + 1 }));
  }, []);
  const value = useMemo(() => announce, [announce]);
  return (
    <AnnounceContext value={value}>
      {children}
      <p role="status" className="min-h-5 text-muted-foreground text-sm">
        {/* A new node per announcement, so the same message twice is read twice. */}
        <span key={message.count}>{message.text}</span>
      </p>
    </AnnounceContext>
  );
}

/**
 * A sample's lab number (S12) in groups of three, three and four digits, set in a monospace face
 * so it reads aloud and types on the analyser in short pieces, with a button that copies the
 * digits without spaces. The outcome is announced in the page's status region (WCAG 4.1.3).
 */
export function LabNumber({ value }: Readonly<{ value: string }>) {
  const announce = useContext(AnnounceContext);
  const grouped = formatLabNumber(value);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      announce?.(m.records_lab_number_copied({ number: grouped }));
    } catch {
      // NOTE: WCAG 4.1.3; a browser that refuses the clipboard is told in the status region,
      // and the number stays on screen to type.
      announce?.(m.records_lab_number_copy_failed());
    }
  }
  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-mono text-base tracking-wide tabular-nums">{grouped}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={m.records_lab_number_copy({ number: grouped })}
        title={m.records_lab_number_copy({ number: grouped })}
        onClick={() => void copy()}
      >
        <CopyIcon aria-hidden="true" />
      </Button>
    </span>
  );
}
