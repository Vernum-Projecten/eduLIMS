// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom

// The correct values as one grid (#401, D10, D13): each cell named by its test and sample, Enter
// edits and saves through the correct-value service, Escape cancels, an empty save clears a
// value, the arrow keys move between cells; the paste dialog marks each part that does not read
// at its header, row or cell before anything is stored. Server functions are mocked; every test,
// sample and value is invented (Q-PRIV-4).
import { readFileSync } from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useGridPaste } from "@/components/correct-values/grid-paste";
import { ValuesGrid } from "@/components/correct-values/values-grid";
import { asCorrectValue } from "@/lib/correct-values";
import type { CorrectValuesPage } from "@/server/correct-values/queries";
import { correctValuesQueryOptions } from "@/server/correct-values/query-options";

/** Every exported server function of `file` as a mock, so a module that imports one loads. */
function mockedFunctions(file: string) {
  const names = [...readFileSync(file, "utf8").matchAll(/export const (\w+) = createServerFn/g)];
  return Object.fromEntries(names.map((match) => [match[1] ?? "", vi.fn()]));
}

vi.mock("@/server/simulations/functions", () =>
  mockedFunctions("src/server/simulations/functions.ts"),
);
vi.mock("@/server/correct-values/functions", () =>
  mockedFunctions("src/server/correct-values/functions.ts"),
);
vi.mock("@/server/catalogue/functions", () => mockedFunctions("src/server/catalogue/functions.ts"));
vi.mock("@tanstack/react-start", async (original) => ({
  ...(await original<typeof import("@tanstack/react-start")>()),
  useServerFn: <T,>(fn: T) => fn,
}));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const { setCorrectValuesFn, removeCorrectValueFn } = await import(
  "@/server/correct-values/functions"
);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const SIM = "01960000-0000-7000-8000-000000000001";
const GLU = "01960000-0000-7000-8000-0000000000a1";
const URE = "01960000-0000-7000-8000-0000000000a2";

const PAGE: CorrectValuesPage = {
  simulationId: SIM,
  state: "prepared",
  values: [
    {
      id: "01960000-0000-7000-8000-0000000000c1",
      sampleNumber: "S-1",
      testId: GLU,
      value: asCorrectValue("5.2"),
      updatedAt: "2026-11-20T10:00:00.000Z",
    },
    {
      id: "01960000-0000-7000-8000-0000000000c2",
      sampleNumber: "S-2",
      testId: URE,
      value: asCorrectValue("7"),
      updatedAt: "2026-11-20T10:00:00.000Z",
    },
  ],
  tests: [
    { id: GLU, name: "Glucose", unit: "mmol/L", retired: false, values: 1, limits: null },
    {
      id: URE,
      name: "Urea",
      unit: "mmol/L",
      retired: false,
      values: 1,
      limits: { kind: "percent", yellow: "5", red: "10" },
    },
  ],
  options: [
    { id: GLU, name: "Glucose", unit: "mmol/L" },
    { id: URE, name: "Urea", unit: "mmol/L" },
  ],
};

function client(): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  });
  queryClient.setQueryData(correctValuesQueryOptions(SIM).queryKey, PAGE);
  return queryClient;
}

const saved = vi.fn();

function PasteHarness() {
  const paste = useGridPaste(SIM, saved);
  return (
    <>
      {paste.button}
      {paste.dialog}
    </>
  );
}

function renderGrid() {
  return render(
    <QueryClientProvider client={client()}>
      <ValuesGrid simulationId={SIM} emptyAction={null} onSaved={saved} />
    </QueryClientProvider>,
  );
}

describe("ValuesGrid (#401)", () => {
  it("shows samples as rows and tests as columns, the limits in the header", () => {
    renderGrid();
    const grid = screen.getByRole("table");
    expect(within(grid).getByRole("rowheader", { name: "S-1" })).toBeDefined();
    expect(within(grid).getByRole("columnheader", { name: /^Glucose/ }).textContent).toContain(
      "No accuracy limits yet: this blocks the start.",
    );
    expect(within(grid).getByRole("columnheader", { name: /^Urea/ }).textContent).toContain(
      "Yellow beyond 5%, red beyond 10%",
    );
    expect(screen.getByRole("button", { name: "Glucose of sample S-1: 5.2 mmol/L" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Urea of sample S-1: not requested" })).toBeDefined();
    expect(
      screen.getByRole("region", { name: "Correct values per sample and test" }),
    ).toBeDefined();
  });

  it("moves between cells with the arrow keys", () => {
    renderGrid();
    const first = screen.getByRole("button", { name: /^Glucose of sample S-1/ });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /^Urea of sample S-1/ }),
    );
    fireEvent.keyDown(document.activeElement ?? first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /^Urea of sample S-2/ }),
    );
  });

  it("edits a cell with Enter, cancels with Escape and returns focus to the cell", async () => {
    renderGrid();
    fireEvent.click(screen.getByRole("button", { name: /^Glucose of sample S-1/ }));
    const field = screen.getByLabelText("Correct value of Glucose for sample S-1");
    await waitFor(() => expect(document.activeElement).toBe(field));
    fireEvent.change(field, { target: { value: "9" } });
    fireEvent.keyDown(field, { key: "Escape" });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Glucose of sample S-1: 5.2 mmol/L" }),
      ),
    );
    expect(setCorrectValuesFn).not.toHaveBeenCalled();
  });

  it("saves a cell through the correct-value service, and refuses a value that is no number", async () => {
    vi.mocked(setCorrectValuesFn).mockResolvedValue({
      ok: true,
      value: { added: 1, changed: 0, unchanged: 0 },
    });
    renderGrid();
    fireEvent.click(screen.getByRole("button", { name: /^Urea of sample S-1/ }));
    const field = screen.getByLabelText("Correct value of Urea for sample S-1");
    fireEvent.change(field, { target: { value: "low" } });
    fireEvent.submit(field.closest("form") ?? field);
    expect(await screen.findByText(/^Enter a number with at most 9 digits/)).toBeDefined();
    expect(setCorrectValuesFn).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: "6,5" } });
    fireEvent.submit(field.closest("form") ?? field);
    await waitFor(() =>
      expect(setCorrectValuesFn).toHaveBeenCalledWith({
        data: { simulationId: SIM, rows: [{ sampleNumber: "S-1", testId: URE, value: "6,5" }] },
      }),
    );
    // The page's status line says what was saved, beside the toast (WCAG 4.1.3).
    await waitFor(() => expect(saved).toHaveBeenCalledWith("Saved Urea of sample S-1."));
  });

  it("clears a stored value when the cell is saved empty", async () => {
    vi.mocked(removeCorrectValueFn).mockResolvedValue({ ok: true, value: null });
    renderGrid();
    fireEvent.click(screen.getByRole("button", { name: /^Glucose of sample S-1/ }));
    const field = screen.getByLabelText("Correct value of Glucose for sample S-1");
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.submit(field.closest("form") ?? field);
    await waitFor(() =>
      expect(removeCorrectValueFn).toHaveBeenCalledWith({
        data: { simulationId: SIM, correctValueId: "01960000-0000-7000-8000-0000000000c1" },
      }),
    );
    await waitFor(() =>
      expect(saved).toHaveBeenCalledWith("Glucose of sample S-1 is no longer requested."),
    );
  });
});

describe("the paste of a grid (#401)", () => {
  it("marks an unknown test at its header and a bad value at its cell, and stores nothing", async () => {
    render(
      <QueryClientProvider client={client()}>
        <PasteHarness />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Paste values" }));
    const dialog = await screen.findByRole("dialog", { name: "Paste the grid" });
    const field = within(dialog).getByLabelText("Grid to paste");
    fireEvent.change(field, { target: { value: "Sample\tAlbumin\tGlucose\nS-1\t1\tx" } });
    const preview = within(dialog).getByRole("region", { name: "Preview of the paste" });
    expect(within(preview).getByRole("columnheader", { name: /Albumin/ }).textContent).toContain(
      "The catalogue has no active test named “Albumin”.",
    );
    expect(within(preview).getByRole("cell", { name: /^x/ }).textContent).toContain(
      "Enter a number",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Save values" }));
    expect(
      await within(dialog).findByText(
        "2 parts of the paste need a fix. They are marked in the preview.",
      ),
    ).toBeDefined();
    expect(setCorrectValuesFn).not.toHaveBeenCalled();
  });

  it("stores a grid that reads in one write", async () => {
    vi.mocked(setCorrectValuesFn).mockResolvedValue({
      ok: true,
      value: { added: 2, changed: 0, unchanged: 0 },
    });
    render(
      <QueryClientProvider client={client()}>
        <PasteHarness />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Paste values" }));
    const dialog = await screen.findByRole("dialog", { name: "Paste the grid" });
    fireEvent.change(within(dialog).getByLabelText("Grid to paste"), {
      target: { value: "Sample\tGlucose\tUrea\nS-3\t4,1\t\nS-4\t\t8" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save values" }));
    await waitFor(() =>
      expect(setCorrectValuesFn).toHaveBeenCalledWith({
        data: {
          simulationId: SIM,
          rows: [
            { sampleNumber: "S-3", testId: GLU, value: "4,1" },
            { sampleNumber: "S-4", testId: URE, value: "8" },
          ],
        },
      }),
    );
    expect(setCorrectValuesFn).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(saved).toHaveBeenCalledWith("Correct values saved: 2 added, 0 changed, 0 unchanged."),
    );
  });
});
