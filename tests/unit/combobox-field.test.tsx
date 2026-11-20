// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom

// ComboboxField (#404): typing filters on each option's label and keywords, "none" is a choice of
// its own and the empty value is no choice, readOnly holds the value, and the label, help text
// and error are wired to the input (WCAG 1.3.1, 3.3.1, 3.3.2).
import { revalidateLogic } from "@tanstack/react-form";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { useAppForm } from "@/components/form/app-form";
import { type ComboboxOption, optionMatches } from "@/components/form/combobox-field";

afterEach(cleanup);

// jsdom has no ResizeObserver; the list's positioner measures with it once it opens.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

type Unit = "none" | "umol/L" | "mmol/L";

const OPTIONS: readonly ComboboxOption<Unit>[] = [
  { value: "none", label: "No unit", keywords: "ratio" },
  { value: "umol/L", label: "µmol/L (micromole per litre)", keywords: "umol/L" },
  { value: "mmol/L", label: "mmol/L (millimole per litre)", keywords: "mmol/L" },
];

const schema = z.object({
  unit: z
    .enum(["", "none", "umol/L", "mmol/L"])
    .refine((value) => value !== "", { error: "Choose a unit." }),
});

function UnitForm({
  initial = "",
  readOnly = false,
}: Readonly<{ initial?: Unit | ""; readOnly?: boolean }>) {
  const form = useAppForm({
    defaultValues: { unit: initial as Unit | "" },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: schema },
  });
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.AppForm>
        <form.AppField name="unit">
          {(field) => (
            <field.ComboboxField
              label="Unit"
              description="Search by symbol or name."
              placeholder="Search for a unit"
              emptyText="No unit matches."
              options={OPTIONS}
              readOnly={readOnly}
            />
          )}
        </form.AppField>
        <output data-testid="value">
          <form.Subscribe selector={(state) => state.values.unit}>{(unit) => unit}</form.Subscribe>
        </output>
        <form.SubmitButton>Save</form.SubmitButton>
      </form.AppForm>
    </form>
  );
}

describe("optionMatches", () => {
  it("matches the label and the keywords, ignoring case and spaces around the query", () => {
    const [none, micro] = OPTIONS;
    if (!none || !micro) throw new Error("options missing");
    expect(optionMatches(micro, "µMOL")).toBe(true);
    expect(optionMatches(micro, " umol/l ")).toBe(true);
    expect(optionMatches(micro, "micromole")).toBe(true);
    expect(optionMatches(none, "ratio")).toBe(true);
    expect(optionMatches(micro, "gram")).toBe(false);
  });
});

describe("ComboboxField (#404)", () => {
  it("labels the input and describes it with its help text", () => {
    render(<UnitForm />);
    const input = screen.getByRole("combobox", { name: "Unit" });
    expect(input.getAttribute("aria-describedby")).toBeTruthy();
    const describedBy = input.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(describedBy)?.textContent).toBe("Search by symbol or name.");
  });

  it("shows the label of the chosen option, No unit included", () => {
    render(<UnitForm initial="none" />);
    expect((screen.getByRole("combobox", { name: "Unit" }) as HTMLInputElement).value).toBe(
      "No unit",
    );
  });

  it("refuses the empty value: it is no choice, and the error is wired to the input", async () => {
    render(<UnitForm />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    const input = screen.getByRole("combobox", { name: "Unit" });
    await waitFor(() => expect(input.getAttribute("aria-invalid")).toBe("true"));
    const ids = (input.getAttribute("aria-describedby") ?? "").split(" ");
    expect(ids.map((id) => document.getElementById(id)?.textContent)).toContain("Choose a unit.");
    expect(screen.getByTestId("value").textContent).toBe("");
  });

  it("keeps a read-only value: focusable, announced, and unchanged by typing", () => {
    render(<UnitForm initial="mmol/L" readOnly />);
    const input = screen.getByRole("combobox", { name: "Unit" }) as HTMLInputElement;
    expect(input.getAttribute("aria-readonly")).toBe("true");
    expect(input.hasAttribute("disabled")).toBe(false);
    input.focus();
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "umol" } });
    expect(screen.getByTestId("value").textContent).toBe("mmol/L");
  });
});
