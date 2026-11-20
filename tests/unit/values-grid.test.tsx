// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom

// The correct values as one grid (#401, D10, D13) and the reviews of #408: one Tab stop with the
// arrow keys, Home and End; Enter edits and saves, Escape or leaving the cell cancels; a clear
// says the old value and can be undone; focus finds the nearest cell when its row goes; the
// paste dialog marks every problem, past the first hundred rows too, shows each value as it
// will be stored, refuses a paste over its caps, and sends only cells under known tests. Server
// functions are mocked; every test, sample and value is invented (Q-PRIV-4).
import { readFileSync } from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storedText, useGridPaste } from "@/components/correct-values/grid-paste";
import { type GridStatus, ValuesGrid } from "@/components/correct-values/values-grid";
import { asCorrectValue, GRID_TEXT_MAX, parsePastedGrid } from "@/lib/correct-values";
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
const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("@/lib/toast", () => ({ toast: toasts }));

const { getCorrectValuesFn, setCorrectValuesFn, removeCorrectValueFn } = await import(
  "@/server/correct-values/functions"
);

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const SIM = "01960000-0000-7000-8000-000000000001";
const GLU = "01960000-0000-7000-8000-0000000000a1";
const URE = "01960000-0000-7000-8000-0000000000a2";
const C1 = "01960000-0000-7000-8000-0000000000c1";

const PAGE: CorrectValuesPage = {
  simulationId: SIM,
  state: "prepared",
  values: [
    {
      id: C1,
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

const saved = vi.fn<(status: GridStatus) => void>();

beforeEach(() => {
  vi.mocked(getCorrectValuesFn).mockResolvedValue(PAGE);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function client(page: CorrectValuesPage = PAGE): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  });
  queryClient.setQueryData(correctValuesQueryOptions(SIM).queryKey, page);
  return queryClient;
}

function PasteHarness() {
  const paste = useGridPaste(SIM, saved);
  return (
    <>
      {paste.button}
      {paste.dialog}
    </>
  );
}

function renderGrid(page: CorrectValuesPage = PAGE) {
  return render(
    <QueryClientProvider client={client(page)}>
      <h1 id="page-title" tabIndex={-1}>
        Correct values
      </h1>
      <ValuesGrid
        simulationId={SIM}
        emptyAction={<button type="button">Paste values</button>}
        onSaved={saved}
      />
    </QueryClientProvider>,
  );
}

const cell = (name: RegExp) => screen.getByRole("button", { name });

function openEditor(name: RegExp, label: string): HTMLElement {
  fireEvent.click(cell(name));
  return screen.getByLabelText(label);
}

describe("ValuesGrid (#401, the reviews of #408)", () => {
  it("shows samples as rows, tests as columns, and the limits in a second header row", () => {
    renderGrid();
    const grid = screen.getByRole("table");
    expect(within(grid).getByRole("rowheader", { name: "S-1" })).toBeDefined();
    expect(within(grid).getByText("No accuracy limits yet")).toBeDefined();
    expect(within(grid).getByText("Yellow beyond 5%, red beyond 10%")).toBeDefined();
    expect(cell(/^Glucose of sample S-1: 5.2 mmol\/L$/)).toBeDefined();
    expect(cell(/^Urea of sample S-1: no correct value$/)).toBeDefined();
    expect(
      screen.getByRole("region", { name: "Correct values per sample and test" }),
    ).toBeDefined();
    expect(screen.getByText(/^Enter edits a cell and saves it/)).toBeDefined();
  });

  it("is one Tab stop, with the arrow keys, Home and End moving between cells", () => {
    renderGrid();
    const reachable = screen
      .getAllByRole("button")
      .filter((button) => button.id.startsWith("values-grid-cell-") && button.tabIndex === 0);
    expect(reachable).toHaveLength(1);
    const first = cell(/^Glucose of sample S-1/);
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(document.activeElement).toBe(cell(/^Urea of sample S-1/));
    fireEvent.keyDown(document.activeElement ?? first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(cell(/^Urea of sample S-2/));
    fireEvent.keyDown(document.activeElement ?? first, { key: "Home" });
    expect(document.activeElement).toBe(cell(/^Glucose of sample S-2/));
    fireEvent.keyDown(document.activeElement ?? first, { key: "End" });
    expect(document.activeElement).toBe(cell(/^Urea of sample S-2/));
    expect(cell(/^Urea of sample S-2/).tabIndex).toBe(0);
    expect(first.tabIndex).toBe(-1);
  });

  it("names the instruction in the editor and cancels with Escape, focus back on the cell", async () => {
    renderGrid();
    const field = openEditor(/^Glucose of sample S-1/, "Correct value of Glucose for sample S-1");
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(field.getAttribute("aria-describedby")).toBeTruthy();
    fireEvent.change(field, { target: { value: "9" } });
    fireEvent.keyDown(field, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(cell(/^Glucose of sample S-1: 5.2/)));
    expect(setCorrectValuesFn).not.toHaveBeenCalled();
  });

  it("cancels an edit when focus leaves the cell", async () => {
    renderGrid();
    const field = openEditor(/^Glucose of sample S-1/, "Correct value of Glucose for sample S-1");
    fireEvent.change(field, { target: { value: "9" } });
    fireEvent.focusOut(field, { relatedTarget: document.body });
    await waitFor(() =>
      expect(screen.queryByLabelText("Correct value of Glucose for sample S-1")).toBeNull(),
    );
    expect(setCorrectValuesFn).not.toHaveBeenCalled();
  });

  it("saves a cell, says what it saved in the status line, and sends no toast", async () => {
    vi.mocked(setCorrectValuesFn).mockResolvedValue({
      ok: true,
      value: { added: 1, changed: 0, unchanged: 0 },
    });
    renderGrid();
    const field = openEditor(/^Urea of sample S-1/, "Correct value of Urea for sample S-1");
    fireEvent.change(field, { target: { value: "low" } });
    fireEvent.submit(field.closest("form") ?? field);
    expect(await screen.findByText(/^Enter a number with at most 9 digits/)).toBeDefined();
    expect(setCorrectValuesFn).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: "6,5" } });
    fireEvent.submit(field.closest("form") ?? field);
    await waitFor(() =>
      expect(saved).toHaveBeenCalledWith({ message: "Saved Urea of sample S-1: 6.5 mmol/L." }),
    );
    expect(setCorrectValuesFn).toHaveBeenCalledWith({
      data: { simulationId: SIM, rows: [{ sampleNumber: "S-1", testId: URE, value: "6,5" }] },
    });
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it("keeps focus in the field when the server refuses the value", async () => {
    vi.mocked(setCorrectValuesFn).mockResolvedValue({
      ok: false,
      error: "missing_limits",
      testIds: [GLU],
    });
    renderGrid();
    const field = openEditor(/^Glucose of sample S-2/, "Correct value of Glucose for sample S-2");
    fireEvent.change(field, { target: { value: "4" } });
    fireEvent.submit(field.closest("form") ?? field);
    expect(
      await screen.findByText(
        "Set the accuracy limits of Glucose before you start the simulation.",
      ),
    ).toBeDefined();
    expect(document.activeElement).toBe(field);
    expect(saved).not.toHaveBeenCalled();
  });

  it("clears a value with its old value in the status, Undo restores it, and focus finds a cell", async () => {
    vi.mocked(removeCorrectValueFn).mockResolvedValue({ ok: true, value: null });
    vi.mocked(setCorrectValuesFn).mockResolvedValue({
      ok: true,
      value: { added: 1, changed: 0, unchanged: 0 },
    });
    // The read after the clear: sample S-1 had one value, so its row is gone.
    vi.mocked(getCorrectValuesFn).mockResolvedValue({
      ...PAGE,
      values: PAGE.values.filter((value) => value.id !== C1),
    });
    renderGrid();
    const field = openEditor(/^Glucose of sample S-1/, "Correct value of Glucose for sample S-1");
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.submit(field.closest("form") ?? field);
    await waitFor(() =>
      expect(removeCorrectValueFn).toHaveBeenCalledWith({
        data: { simulationId: SIM, correctValueId: C1 },
      }),
    );
    await waitFor(() => expect(saved).toHaveBeenCalled());
    const status = saved.mock.calls[0]?.[0];
    expect(status?.message).toBe("Correct value cleared: Glucose of sample S-1 (was 5.2 mmol/L).");
    // The row went: focus moves to the cell that took its place (WCAG 2.4.3).
    await waitFor(() => expect(screen.queryByRole("rowheader", { name: "S-1" })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(cell(/^Glucose of sample S-2/)));
    await status?.undo?.();
    expect(setCorrectValuesFn).toHaveBeenCalledWith({
      data: { simulationId: SIM, rows: [{ sampleNumber: "S-1", testId: GLU, value: "5.2" }] },
    });
    expect(saved).toHaveBeenLastCalledWith({
      message: "Restored Glucose of sample S-1: 5.2 mmol/L.",
    });
  });

  it("shows the empty state with its action when the tests have no sample yet", () => {
    renderGrid({ ...PAGE, values: [] });
    expect(screen.getByText("No correct values yet")).toBeDefined();
    expect(screen.getByRole("button", { name: "Paste values" })).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("storedText (security review of #408, S1)", () => {
  it("shows a pasted value as it will be stored when the two read otherwise", () => {
    const [cellText] =
      parsePastedGrid("Sample\tGlucose\nS-1\t1.234", PAGE.options).samples[0]?.cells ?? [];
    expect(cellText).toBe("1.234");
    expect(storedText(cellText ?? "", { locale: "nl" })).toBe("1,234");
    expect(storedText(cellText ?? "", { locale: "en" })).toBeNull();
    expect(storedText("1,5", { locale: "en" })).toBe("1.5");
    expect(storedText("low", { locale: "en" })).toBeNull();
  });
});

describe("the paste of a grid (#401, the reviews of #408)", () => {
  async function openPaste(page: CorrectValuesPage = PAGE) {
    render(
      <QueryClientProvider client={client(page)}>
        <PasteHarness />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Paste values" }));
    const dialog = await screen.findByRole("dialog", { name: "Paste the grid" });
    return { dialog, field: within(dialog).getByLabelText("Grid to paste") };
  }

  it("marks an unknown test at its header and a bad value at its cell, and sends nothing", async () => {
    const { dialog, field } = await openPaste();
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

  it("sends no cell under an unknown column, even under readable rows", async () => {
    // The parser keeps only cells under a known test; the schema then refuses the paste whole.
    const grid = parsePastedGrid("Sample\tAlbumin\tGlucose\nS-1\t1\t2", PAGE.options);
    expect(grid.rows).toEqual([{ sampleNumber: "S-1", testId: GLU, value: "2" }]);
    const { dialog, field } = await openPaste();
    fireEvent.change(field, { target: { value: "Sample\tAlbumin\tGlucose\nS-1\t1\t2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save values" }));
    expect(await within(dialog).findByText(/^1 part of the paste needs a fix/)).toBeDefined();
    expect(setCorrectValuesFn).not.toHaveBeenCalled();
  });

  it("shows a problem past the first hundred rows (WCAG 3.3.1)", async () => {
    const rows = Array.from({ length: 101 }, (_, n) =>
      n === 100 ? `S-${n + 1}\tlow` : `S-${n + 1}\t1`,
    );
    const { dialog, field } = await openPaste();
    fireEvent.change(field, { target: { value: ["Sample\tGlucose", ...rows].join("\n") } });
    const preview = within(dialog).getByRole("region", { name: "Preview of the paste" });
    expect(within(preview).getByRole("rowheader", { name: "S-101" })).toBeDefined();
    expect(within(preview).getByRole("cell", { name: /^low/ }).textContent).toContain(
      "Enter a number",
    );
  });

  it("shows the value as it will be stored next to the pasted text", async () => {
    const { dialog, field } = await openPaste();
    fireEvent.change(field, { target: { value: "Sample\tGlucose\nS-1\t1,5" } });
    const preview = within(dialog).getByRole("region", { name: "Preview of the paste" });
    expect(within(preview).getByRole("cell", { name: /^1,5/ }).textContent).toBe(
      "1,5 (stored as 1.5)",
    );
  });

  it("refuses a paste over its length and its columns, naming the cap", async () => {
    const { dialog, field } = await openPaste();
    fireEvent.change(field, { target: { value: `Sample\tGlucose\n${"S".repeat(GRID_TEXT_MAX)}` } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save values" }));
    expect(
      await within(dialog).findByText(/^The paste is longer than 100000 characters/),
    ).toBeDefined();
    fireEvent.change(field, { target: { value: "Sample\tGlucose\tUrea\tExtra\nS-1\t1\t2\t3" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save values" }));
    expect(
      await within(dialog).findByText(/^The paste has more test columns than the catalogue/),
    ).toBeDefined();
    expect(setCorrectValuesFn).not.toHaveBeenCalled();
  });

  it("marks a test the running simulation refuses at its header and stays open", async () => {
    vi.mocked(setCorrectValuesFn).mockResolvedValue({
      ok: false,
      error: "missing_limits",
      testIds: [GLU],
    });
    const { dialog, field } = await openPaste();
    fireEvent.change(field, { target: { value: "Sample\tGlucose\nS-3\t4" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save values" }));
    const preview = within(dialog).getByRole("region", { name: "Preview of the paste" });
    await waitFor(() =>
      expect(within(preview).getByRole("columnheader", { name: /Glucose/ }).textContent).toContain(
        "Set the accuracy limits of Glucose before you start the simulation.",
      ),
    );
    expect(screen.getByRole("dialog", { name: "Paste the grid" })).toBe(dialog);
    expect(saved).not.toHaveBeenCalled();
  });

  it("stores a grid that reads in one write and says so in the status line only", async () => {
    vi.mocked(setCorrectValuesFn).mockResolvedValue({
      ok: true,
      value: { added: 2, changed: 0, unchanged: 0 },
    });
    const { dialog, field } = await openPaste();
    fireEvent.change(field, { target: { value: "Sample\tGlucose\tUrea\nS-3\t4,1\t\nS-4\t\t8" } });
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
      expect(saved).toHaveBeenCalledWith({
        message: "Correct values saved: 2 added, 0 changed, 0 unchanged.",
      }),
    );
    expect(toasts.success).not.toHaveBeenCalled();
  });
});
