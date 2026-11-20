// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom

// Smoke tests for the shadcn/ui primitives added for the UI redesign (#385): each one renders,
// names its built-in controls through the i18n layer (WCAG 3.1.2), and axe finds no WCAG 2.1 A
// or AA violation in jsdom (Q-ACC-1). jsdom has no layout, so axe reports colour contrast as
// incomplete, not as a pass; the Playwright scan covers contrast on the real screens.
import { cleanup, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { FileTextIcon, InfoIcon } from "lucide-react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { Bubble, BubbleContent, BubbleGroup } from "@/components/ui/bubble";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { DirectionProvider, useDirection } from "@/components/ui/direction";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageGroup,
  MessageHeader,
} from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { m } from "@/i18n/messages";
import { baseLocale, type Locale, overwriteGetLocale } from "@/i18n/runtime";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** Observes nothing: jsdom has no layout, and the primitives only need the constructor. */
class NoopResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** Observes nothing, as {@link NoopResizeObserver}. */
class NoopIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "0px";
  readonly scrollMargin = "0px";
  readonly thresholds: readonly number[] = [];
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

beforeAll(() => {
  // NOTE: no requirement governs this: our own design; jsdom lacks these browser APIs.
  globalThis.ResizeObserver ??= NoopResizeObserver;
  globalThis.IntersectionObserver ??= NoopIntersectionObserver;
  window.matchMedia ??= (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) satisfies MediaQueryList;
});

function inLocale(locale: Locale): void {
  overwriteGetLocale(() => locale);
}

afterEach(() => {
  cleanup();
  overwriteGetLocale(() => baseLocale);
});

/** Returns the ids of the WCAG 2.1 A and AA rules axe finds broken in `node`. */
async function axeViolations(node: Element): Promise<string[]> {
  const result = await axe.run(node, { runOnly: { type: "tag", values: WCAG_TAGS } });
  return result.violations.map((violation) => violation.id);
}

function DemoCarousel() {
  return (
    <Carousel className="mx-12">
      <CarouselContent>
        <CarouselItem>Sample 1</CarouselItem>
        <CarouselItem>Sample 2</CarouselItem>
      </CarouselContent>
      <CarouselPrevious />
      <CarouselNext />
    </Carousel>
  );
}

describe.each(["en", "nl"] as const)("the carousel in %s", (locale) => {
  it("names its region, slides and buttons in the active locale", async () => {
    inLocale(locale);
    const options = { locale } as const;
    const { container } = render(<DemoCarousel />);
    const region = screen.getByRole("region");
    expect(region.getAttribute("aria-roledescription")).toBe(m.ui_carousel({}, options));
    expect(screen.getAllByRole("group")).toHaveLength(2);
    expect(
      screen.getAllByRole("group").map((slide) => slide.getAttribute("aria-roledescription")),
    ).toEqual([m.ui_carousel_slide({}, options), m.ui_carousel_slide({}, options)]);
    expect(screen.getByRole("button", { name: m.ui_carousel_previous({}, options) })).toBeDefined();
    expect(screen.getByRole("button", { name: m.ui_carousel_next({}, options) })).toBeDefined();
    expect(await axeViolations(container)).toEqual([]);
  });
});

function DemoCombobox() {
  return (
    <Combobox items={["HbA1c", "CRP"]} defaultValue="CRP">
      <ComboboxInput aria-label="Test" showClear />
      <ComboboxContent>
        <ComboboxEmpty>None</ComboboxEmpty>
        <ComboboxList>
          {(item: string) => (
            <ComboboxItem key={item} value={item}>
              {item}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

describe("the combobox", () => {
  it("names its input and its icon-only buttons in the active locale", async () => {
    inLocale("nl");
    const dutch = { locale: "nl" } as const;
    const { container } = render(<DemoCombobox />);
    expect(screen.getByRole("combobox", { name: "Test" })).toBeDefined();
    expect(screen.getByRole("button", { name: m.ui_combobox_open({}, dutch) })).toBeDefined();
    expect(screen.getByRole("button", { name: m.ui_combobox_clear({}, dutch) })).toBeDefined();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("the one-time code input", () => {
  it("renders its slots and passes axe", async () => {
    const { container } = render(
      <InputOTP maxLength={4} aria-label="Code">
        <InputOTPGroup>
          <InputOTPSlot index={0} />
          <InputOTPSlot index={1} />
        </InputOTPGroup>
        <InputOTPSeparator />
        <InputOTPGroup>
          <InputOTPSlot index={2} />
          <InputOTPSlot index={3} />
        </InputOTPGroup>
      </InputOTP>,
    );
    expect(screen.getByRole("textbox", { name: "Code" })).toBeDefined();
    expect(container.querySelectorAll("[data-slot=input-otp-slot]")).toHaveLength(4);
    expect(await axeViolations(container)).toEqual([]);
  });
});

function ShowDirection() {
  return <output>{useDirection()}</output>;
}

describe("the direction provider", () => {
  it("hands its direction to the primitives below it", () => {
    render(
      <DirectionProvider dir="rtl">
        <ShowDirection />
      </DirectionProvider>,
    );
    expect(screen.getByRole("status").textContent).toBe("rtl");
  });
});

describe("the attachment", () => {
  it("renders a file with its action and passes axe", async () => {
    const { container } = render(
      <Attachment>
        <AttachmentMedia>
          <FileTextIcon aria-hidden="true" />
        </AttachmentMedia>
        <AttachmentContent>
          <AttachmentTitle>plate-01.xlsx</AttachmentTitle>
          <AttachmentDescription>12 kB</AttachmentDescription>
        </AttachmentContent>
        <AttachmentActions>
          <AttachmentAction aria-label="Remove plate-01.xlsx">×</AttachmentAction>
        </AttachmentActions>
      </Attachment>,
    );
    expect(screen.getByText("plate-01.xlsx")).toBeDefined();
    expect(screen.getByRole("button", { name: "Remove plate-01.xlsx" })).toBeDefined();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("the bubble", () => {
  it("renders its content at both alignments and passes axe", async () => {
    const { container } = render(
      <BubbleGroup>
        <Bubble>
          <BubbleContent>First</BubbleContent>
        </Bubble>
        <Bubble align="end" variant="secondary">
          <BubbleContent>Second</BubbleContent>
        </Bubble>
      </BubbleGroup>,
    );
    expect(
      screen.getByText("Second").closest("[data-slot=bubble]")?.getAttribute("data-align"),
    ).toBe("end");
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("the marker", () => {
  it("hides its icon from assistive technology and passes axe", async () => {
    const { container } = render(
      <Marker variant="separator">
        <MarkerIcon>
          <InfoIcon />
        </MarkerIcon>
        <MarkerContent>Today</MarkerContent>
      </Marker>,
    );
    expect(container.querySelector("[data-slot=marker-icon]")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(screen.getByText("Today")).toBeDefined();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("the message", () => {
  it("renders its parts and passes axe", async () => {
    const { container } = render(
      <MessageGroup>
        <Message align="end">
          <MessageAvatar>AB</MessageAvatar>
          <MessageContent>
            <MessageHeader>Lab A</MessageHeader>
            <p>Body</p>
            <MessageFooter>Sent</MessageFooter>
          </MessageContent>
        </Message>
      </MessageGroup>,
    );
    expect(container.querySelector("[data-slot=message]")?.getAttribute("data-align")).toBe("end");
    expect(screen.getByText("Body")).toBeDefined();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe.each(["en", "nl"] as const)("the message scroller in %s", (locale) => {
  it("names its viewport in the active locale and passes axe", async () => {
    inLocale(locale);
    const { container } = render(
      <MessageScrollerProvider>
        <MessageScroller>
          <MessageScrollerViewport>
            <MessageScrollerContent>
              <MessageScrollerItem messageId="one">One</MessageScrollerItem>
              <MessageScrollerItem messageId="two">Two</MessageScrollerItem>
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>,
    );
    const viewport = container.querySelector("[data-slot=message-scroller-viewport]");
    expect(viewport?.getAttribute("aria-label")).toBe(m.ui_messages({}, { locale }));
    expect(screen.getByText("Two")).toBeDefined();
    expect(await axeViolations(container)).toEqual([]);
  });
});
