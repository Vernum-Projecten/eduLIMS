// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom

// The shadcn/ui primitives name their built-in controls through the i18n layer, so a Dutch
// user never hears English (WCAG 3.1.2; #27, #55).
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbList,
} from "@/components/ui/breadcrumb";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { m } from "@/i18n/messages";
import { baseLocale, type Locale, overwriteGetLocale } from "@/i18n/runtime";

/** Renders under `locale`, as the locale cookie would select it. */
function inLocale(locale: Locale): void {
  overwriteGetLocale(() => locale);
}

afterEach(() => {
  cleanup();
  overwriteGetLocale(() => baseLocale);
});

function OpenDialog() {
  return (
    <Dialog open>
      <DialogContent>
        <DialogTitle>Title</DialogTitle>
        <DialogDescription>Description</DialogDescription>
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}

function OpenSheet() {
  return (
    <Sheet open>
      <SheetContent>
        <SheetTitle>Title</SheetTitle>
        <SheetDescription>Description</SheetDescription>
      </SheetContent>
    </Sheet>
  );
}

describe.each([
  ["en", "Close"],
  ["nl", "Sluiten"],
] as const)("the close controls in %s", (locale, close) => {
  it("name the dialog's corner and footer close buttons", () => {
    inLocale(locale);
    render(<OpenDialog />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelectorAll("button")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: close })).toHaveLength(2);
  });

  it("name the sheet's close button", () => {
    inLocale(locale);
    render(<OpenSheet />);
    expect(screen.getByRole("button", { name: close })).toBeDefined();
  });
});

describe("the other built-in labels in Dutch", () => {
  const dutch = { locale: "nl" } as const;

  it("names the pagination and its controls", () => {
    inLocale("nl");
    render(
      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious href="#previous" />
          </PaginationItem>
          <PaginationItem>
            <PaginationEllipsis />
          </PaginationItem>
          <PaginationItem>
            <PaginationNext href="#next" />
          </PaginationItem>
        </PaginationContent>
      </Pagination>,
    );
    expect(screen.getByRole("navigation", { name: m.ui_pagination({}, dutch) })).toBeDefined();
    const previous = screen.getByRole("link", { name: m.ui_page_previous_label({}, dutch) });
    expect(previous.textContent).toBe(m.ui_page_previous({}, dutch));
    const next = screen.getByRole("link", { name: m.ui_page_next_label({}, dutch) });
    expect(next.textContent).toBe(m.ui_page_next({}, dutch));
    expect(screen.getByText(m.ui_more_pages({}, dutch))).toBeDefined();
    expect(m.ui_page_next({}, dutch)).not.toBe(m.ui_page_next({}, { locale: "en" }));
  });

  it("names the breadcrumb and its ellipsis", () => {
    inLocale("nl");
    render(
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbEllipsis />
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>,
    );
    expect(screen.getByRole("navigation", { name: m.breadcrumb_label({}, dutch) })).toBeDefined();
    expect(screen.getByText(m.ui_more({}, dutch))).toBeDefined();
  });

  it("names the spinner", () => {
    inLocale("nl");
    render(<Spinner />);
    expect(screen.getByRole("status", { name: m.loading({}, dutch) })).toBeDefined();
  });

  it("names the calendar's month buttons in the active locale by default", () => {
    inLocale("nl");
    render(<Calendar mode="single" defaultMonth={new Date(2026, 10, 1)} />);
    expect(screen.getByRole("button", { name: "Ga naar volgende maand" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Ga naar vorige maand" })).toBeDefined();
    expect(screen.queryByRole("button", { name: /Go to the Next Month/i })).toBeNull();
  });

  it("marks today in the app's time zone, not the browser's", () => {
    // 23:30 UTC on 11 November is already 12 November in Amsterdam (APP_TIME_ZONE).
    vi.useFakeTimers({ now: new Date("2026-11-11T23:30:00Z"), toFake: ["Date"] });
    try {
      inLocale("en");
      const { container } = render(<Calendar mode="single" />);
      const today = container.querySelector("[data-today]");
      expect(today?.textContent).toBe("12");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the English month buttons in English", () => {
    inLocale("en");
    render(<Calendar mode="single" defaultMonth={new Date(2026, 10, 1)} />);
    expect(screen.getByRole("button", { name: "Go to the Next Month" })).toBeDefined();
  });
});
