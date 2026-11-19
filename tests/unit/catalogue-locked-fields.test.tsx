// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom

// Read-only fields (WCAG 3.3.2, the UI review of #312): a setting a test's usage fixes stays
// focusable and readable with its reason beside it, and no input changes it. The usage is mocked:
// no simulation uses a test until #267, so no e2e fixture reaches a used test yet.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppForm } from "@/components/form/app-form";
import { TestFormDialog } from "@/components/teacher-catalogue/test-form-dialog";
import { parseCatalogueTestId, type TestUsage } from "@/lib/catalogue";
import type { CatalogueTestRow } from "@/server/catalogue/queries";

vi.mock("@/server/catalogue/functions", () => ({
  listCatalogueTests: vi.fn(),
  createCatalogueTest: vi.fn(),
  updateCatalogueTest: vi.fn(),
  retireCatalogueTest: vi.fn(),
  restoreCatalogueTest: vi.fn(),
}));
vi.mock("@tanstack/react-start", async (original) => ({
  ...(await original<typeof import("@tanstack/react-start")>()),
  useServerFn: <T,>(fn: T) => fn,
}));

afterEach(cleanup);

// jsdom has no ResizeObserver; Radix measures with it once a dialog opens.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

/** Returns the text of the help and error an element names in `aria-describedby`. */
function description(element: HTMLElement): string {
  return (element.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .flatMap((id) => {
      const text = id === "" ? null : document.getElementById(id)?.textContent;
      return text ? [text] : [];
    })
    .join(" ");
}

function readOnly(element: HTMLElement): boolean {
  return element.hasAttribute("readonly") || element.getAttribute("aria-readonly") === "true";
}

function ReadOnlyFields() {
  const form = useAppForm({
    defaultValues: { text: "mg/L", choice: "b" as "a" | "b" | "", radio: "a" as "a" | "b" | "" },
  });
  const options = [
    { value: "a" as const, label: "Option A" },
    { value: "b" as const, label: "Option B" },
  ];
  return (
    <form.AppForm>
      <form.AppField name="text">
        {(field) => <field.TextField label="Text" readOnly />}
      </form.AppField>
      <form.AppField name="choice">
        {(field) => (
          <field.SelectField label="Choice" placeholder="Pick" options={options} readOnly />
        )}
      </form.AppField>
      <form.AppField name="radio">
        {(field) => <field.RadioGroupField label="Radio" options={options} readOnly />}
      </form.AppField>
    </form.AppForm>
  );
}

describe("readOnly on the registered fields (WCAG 3.3.2)", () => {
  it("keeps a text field focusable and unchanged", () => {
    render(<ReadOnlyFields />);
    const text = screen.getByLabelText("Text");
    expect(readOnly(text)).toBe(true);
    expect(text.hasAttribute("disabled")).toBe(false);
    text.focus();
    expect(document.activeElement).toBe(text);
  });

  it("keeps a select focusable, announced read-only, and closed", () => {
    render(<ReadOnlyFields />);
    const select = screen.getByRole("combobox", { name: "Choice" });
    expect(readOnly(select)).toBe(true);
    expect(select.hasAttribute("disabled")).toBe(false);
    fireEvent.keyDown(select, { key: "Enter" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(select.textContent).toContain("Option B");
  });

  it("keeps a radio group announced read-only, and its choice unchanged", () => {
    render(<ReadOnlyFields />);
    const group = screen.getByRole("radiogroup", { name: "Radio" });
    expect(readOnly(group)).toBe(true);
    const b = within(group).getByRole("radio", { name: "Option B" });
    expect(b.hasAttribute("disabled")).toBe(false);
    fireEvent.click(b);
    expect(
      within(group).getByRole("radio", { name: "Option A" }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(b.getAttribute("aria-checked")).toBe("false");
  });
});

function row(usage: TestUsage, source: CatalogueTestRow["source"]): CatalogueTestRow {
  const id = parseCatalogueTestId("01960000-0000-7000-8000-000000000001");
  if (id === null) throw new Error("not a UUID");
  return {
    id,
    name: "Glucose",
    unit: "mmol/L",
    material: "plasma",
    source,
    status: "active",
    updatedAt: "2026-11-19T09:00:00.000Z",
    usage,
  };
}

function openDialog(test: CatalogueTestRow) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TestFormDialog test={test} control={{ open: true, onOpenChange: () => undefined }} />
    </QueryClientProvider>,
  );
  return screen.getByRole("dialog");
}

describe("the test form locks what the usage fixes (D9; maintainer 2026-11-19)", () => {
  const epoch = { kind: "epoch_upload", calculatedBy: "team" } as const;

  it("locks nothing of an unused test", () => {
    const dialog = openDialog(row("unused", epoch));
    expect(readOnly(within(dialog).getByLabelText("Unit (optional)"))).toBe(false);
    expect(readOnly(within(dialog).getByLabelText("Material"))).toBe(false);
  });

  it("locks the unit and the source of a used test, with the reason, and leaves the rest", () => {
    const dialog = openDialog(row("used", epoch));
    const unit = within(dialog).getByLabelText("Unit (optional)");
    expect(readOnly(unit)).toBe(true);
    expect(description(unit)).toContain("Fixed while a simulation uses this test.");
    expect(
      readOnly(within(dialog).getByRole("combobox", { name: "Source of the measurements" })),
    ).toBe(true);
    expect(readOnly(within(dialog).getByLabelText("Name"))).toBe(false);
    expect(readOnly(within(dialog).getByLabelText("Material"))).toBe(false);
    expect(
      readOnly(
        within(dialog).getByRole("radiogroup", { name: "Who calculates the concentration" }),
      ),
    ).toBe(false);
    expect(description(dialog)).toContain(
      "A simulation uses this test: you can change its name, material and who calculates, but not its unit or source.",
    );
  });

  it("names only its own source's settings in the description of a used Afinion 2 test", () => {
    const dialog = openDialog(row("used", { kind: "afinion", analyte: "CRP" }));
    expect(readOnly(within(dialog).getByLabelText("Analyte name on the Afinion 2"))).toBe(true);
    expect(description(dialog)).toContain(
      "A simulation uses this test: you can change its name and material, but not its unit, source or analyte name.",
    );
  });

  it("also locks the material and who calculates while a running simulation uses it", () => {
    const dialog = openDialog(row("running", epoch));
    const material = within(dialog).getByLabelText("Material");
    expect(readOnly(material)).toBe(true);
    expect(description(material)).toContain("Fixed while a running simulation uses this test.");
    expect(
      readOnly(
        within(dialog).getByRole("radiogroup", { name: "Who calculates the concentration" }),
      ),
    ).toBe(true);
    expect(readOnly(within(dialog).getByLabelText("Name"))).toBe(false);
  });
});
