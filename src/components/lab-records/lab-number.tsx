// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { CheckIcon, CopyIcon } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { m } from "@/i18n/messages";
import { formatLabNumber, spellLabNumber } from "@/lib/lab-number";

/** How long the copy button shows its check mark after a copy. */
const COPIED_MS = 2000;

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
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    // A reset after a fixed time, not a debounce: the check mark only confirms the copy.
    const reset = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(reset);
  }, [copied]);
  // NOTE: maintainer, 2026-11-20 (#353 review, N3); the name spells the digits one by one, so a
  // screen reader reads each digit; the button shows only an icon, so WCAG 2.5.3 holds.
  const name = m.records_lab_number_copy({ number: spellLabNumber(value) });
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
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
        aria-label={name}
        title={m.records_lab_number_copy({ number: grouped })}
        onClick={() => void copy()}
      >
        {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
      </Button>
    </span>
  );
}
