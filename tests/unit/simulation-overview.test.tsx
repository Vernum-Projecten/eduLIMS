// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom

// The overview of a simulation (#381, the UI review of #394): the checklist from the server's
// read alone, a blocked Start that stays focusable and sends focus to the step that blocks it,
// and a refused start that returns focus to Start and names the tests in its toast. The server
// functions are mocked; nothing here reads a database.
import { readFileSync } from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LimitsText } from "@/components/correct-values/limits-dialog";
import { firstBlockingStep, stepsOf } from "@/components/simulations/preparation-steps";
import { PreparationChecklist } from "@/components/simulations/simulation-overview";
import {
  SimulationPrimaryAction,
  startErrorMessage,
} from "@/components/simulations/simulation-state";
import { SimulationActionRefused } from "@/server/simulations/query-options";
import type { SimulationReadiness } from "@/server/simulations/readiness";

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
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  Link: ({ children, to, className }: { children: ReactNode; to: string; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));
const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("@/lib/toast", () => ({ toast: toasts }));

const { startSimulationFn } = await import("@/server/simulations/functions");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Returns the text an element's `aria-describedby` names, joined by spaces. */
function description(element: HTMLElement): string {
  return (element.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .flatMap((id) => {
      const text = id === "" ? null : document.getElementById(id)?.textContent;
      return text ? [text] : [];
    })
    .join(" ");
}

// jsdom has no ResizeObserver; Radix measures with it once a dialog opens.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const READY: SimulationReadiness = {
  simulationId: "01960000-0000-7000-8000-000000000001",
  state: "prepared",
  startedAt: null,
  finishedAt: null,
  labs: { count: 2, empty: 0, students: 7, waiting: 1 },
  values: { count: 3, tests: 2 },
  missingLimits: [],
  startRefusal: null,
};

const NO_STUDENTS: SimulationReadiness = {
  ...READY,
  labs: { count: 1, empty: 1, students: 0, waiting: 0 },
  startRefusal: { error: "no_students" },
};

const MISSING: SimulationReadiness = {
  ...READY,
  missingLimits: [
    { id: "t-alb", name: "Albumin" },
    { id: "t-glu", name: "Glucose" },
  ],
  startRefusal: { error: "missing_limits", testIds: ["t-alb", "t-glu"] },
};

function renderWith(readiness: SimulationReadiness) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <h1 id="page-title" tabIndex={-1}>
        Overview
      </h1>
      <SimulationPrimaryAction name="Demo" readiness={readiness} />
      <PreparationChecklist readiness={readiness} />
    </QueryClientProvider>,
  );
}

describe("stepsOf (#381, #394)", () => {
  it("marks every step done and the start open for a ready simulation", () => {
    expect(stepsOf(READY).map((step) => [step.id, step.status])).toEqual([
      ["labs", "done"],
      ["values", "done"],
      ["limits", "done"],
      ["start", "todo"],
    ]);
  });

  it("counts in the singular and the plural", () => {
    const one = { ...READY, labs: { count: 1, empty: 0, students: 1, waiting: 1 } };
    expect(stepsOf(one)[0]?.description).toBe("1 lab, 1 student, 1 address waiting.");
    expect(stepsOf(READY)[0]?.description).toBe("2 labs, 7 students, 1 address waiting.");
    expect(stepsOf(READY)[1]?.description).toBe("3 correct values for 2 tests.");
  });

  it("blocks on the labs without a student, and on the values without a value", () => {
    const empty = { ...NO_STUDENTS, values: { count: 0, tests: 0 } };
    expect(stepsOf(empty).map((step) => step.status)).toEqual([
      "blocks",
      "blocks",
      "todo",
      "blocks",
    ]);
    expect(firstBlockingStep(empty)).toBe("labs");
  });

  it("names the tests without limits as a list", () => {
    const limits = stepsOf(MISSING)[2];
    expect(limits?.status).toBe("blocks");
    expect(limits?.description).toBe(
      "Before you can start, set the accuracy limits of: Albumin and Glucose.",
    );
    expect(firstBlockingStep(MISSING)).toBe("limits");
  });

  it("shows a reason no step above owns at the start step", () => {
    const other = { ...READY, startRefusal: { error: "not_prepared" as const } };
    expect(stepsOf(other)[3]?.status).toBe("blocks");
    expect(firstBlockingStep(other)).toBe("start");
  });
});

describe("PreparationChecklist (#381)", () => {
  it("shows each step with its status in text and the next step", () => {
    renderWith(NO_STUDENTS);
    expect(screen.getByText("Next step: Labs and students.")).toBeDefined();
    const labs = screen.getByRole("heading", { level: 3, name: "Labs and students" });
    const item = labs.closest('[role="listitem"]');
    if (!(item instanceof HTMLElement)) throw new Error("no step item");
    expect(within(item).getByText("Blocks the start")).toBeDefined();
    expect(within(item).getByRole("link", { name: "Open labs" })).toBeDefined();
  });
});

describe("SimulationPrimaryAction (#381, the UI review of #394)", () => {
  it("keeps a blocked Start focusable, says why, and sends focus to the blocking step", () => {
    renderWith(NO_STUDENTS);
    const start = screen.getByRole("button", { name: "Start simulation" });
    expect(start.getAttribute("aria-disabled")).toBe("true");
    expect(start.hasAttribute("disabled")).toBe(false);
    const describedBy = start.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(describedBy)?.textContent).toBe(
      "Add a student to a lab first. Open labs",
    );
    start.focus();
    fireEvent.click(start);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    const heading = screen.getByRole("heading", { level: 3, name: "Labs and students" });
    expect(document.activeElement).toBe(heading);
    // The focused heading carries its status and its reason (the UI review of #403).
    expect(description(heading)).toBe(
      "Blocks the start 1 lab, 0 students, 0 addresses waiting. No lab has a student yet, and the start needs one.",
    );
  });

  it("sends focus to the start step when no step above owns the reason", () => {
    renderWith({ ...READY, startRefusal: { error: "not_prepared" } });
    const start = screen.getByRole("button", { name: "Start simulation" });
    fireEvent.click(start);
    const step = screen.getByRole("heading", { level: 3, name: "Start" });
    expect(step.id).toBe("step-start");
    expect(document.activeElement).toBe(step);
    expect(description(step)).toContain("Blocks the start");
  });

  it("returns focus to Start after a refused start, and names the tests in the toast", async () => {
    vi.mocked(startSimulationFn).mockResolvedValue({
      ok: false,
      error: "missing_limits",
      testIds: ["t-alb"],
    });
    renderWith({ ...READY, missingLimits: [{ id: "t-alb", name: "Albumin" }] });
    const start = screen.getByRole("button", { name: "Start simulation" });
    fireEvent.click(start);
    const dialog = await screen.findByRole("alertdialog", { name: "Start Demo?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Start" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(start));
    expect(toasts.error).toHaveBeenCalledWith(
      "Set the accuracy limits of Albumin before you start the simulation.",
    );
  });
});

describe("LimitsText (D13, #394)", () => {
  const test = {
    id: "t-alb",
    name: "Albumin",
    unit: "g/L",
    retired: false,
    values: 1,
    limits: null,
    simulationId: READY.simulationId,
  };

  it("says that a test without limits blocks the start while the simulation is prepared", () => {
    render(<LimitsText test={test} blocksStart />);
    expect(screen.getByText("No accuracy limits yet: this blocks the start.")).toBeDefined();
  });

  it("says only that the limits are missing once the simulation runs", () => {
    render(<LimitsText test={test} blocksStart={false} />);
    expect(screen.getByText("No accuracy limits yet")).toBeDefined();
    expect(screen.queryByText(/blocks the start/)).toBeNull();
  });

  it("words the limits a test has", () => {
    render(
      <LimitsText
        test={{ ...test, limits: { kind: "percent", yellow: "5", red: "10" } }}
        blocksStart
      />,
    );
    expect(screen.getByText("Yellow beyond 5%, red beyond 10%")).toBeDefined();
  });
});

describe("startErrorMessage (#267, #394)", () => {
  const names = new Map([
    ["t-alb", "Albumin"],
    ["t-glu", "Glucose"],
  ]);

  it("names the tests of missing_limits as a list", () => {
    const error = new SimulationActionRefused("missing_limits", ["t-alb", "t-glu"]);
    expect(startErrorMessage(error, names)).toBe(
      "Set the accuracy limits of Albumin and Glucose before you start the simulation.",
    );
  });

  it("words the other refusals by their code", () => {
    expect(startErrorMessage(new SimulationActionRefused("no_students"), names)).toBe(
      "Add a student to at least one lab before you start the simulation.",
    );
    expect(startErrorMessage(new SimulationActionRefused("no_correct_values"), names)).toBe(
      "Enter at least one correct value before you start the simulation.",
    );
    expect(startErrorMessage(new Error("network"), names)).toBe(
      startErrorMessage(new Error("other"), names),
    );
  });
});
