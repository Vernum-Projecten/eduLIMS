// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom

import { revalidateLogic } from "@tanstack/react-form";
// The form foundation (#61): the registered fields wire their label, help text and error to the
// control, sync and debounced async validation show at the field, a server refusal lands at its
// field or at the top of the form, and a keystroke renders only its own field.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Profiler, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { useAppForm } from "@/components/form/app-form";
import { baseLocale, overwriteGetLocale } from "@/i18n/runtime";
import { applyServerRefusal } from "@/lib/forms/server-refusal";

afterEach(() => {
  cleanup();
  overwriteGetLocale(() => baseLocale);
});

const schema = z.object({
  first: z.string().min(1, { error: "Enter the first value." }),
  second: z.string().min(1, { error: "Enter the second value." }),
});

/** Counts the commits of each part of the form while it is on screen. */
function counted(renders: Map<string, number>, id: string, children: ReactNode) {
  return (
    <Profiler id={id} onRender={() => renders.set(id, (renders.get(id) ?? 0) + 1)}>
      {children}
    </Profiler>
  );
}

function TwoFields({
  renders,
  second = "",
  validateOn = "change",
}: Readonly<{
  renders: Map<string, number>;
  second?: string;
  validateOn?: "change" | "submit";
}>) {
  const form = useAppForm({
    defaultValues: { first: "", second },
    ...(validateOn === "change"
      ? { validators: { onChange: schema } }
      : { validationLogic: revalidateLogic(), validators: { onDynamic: schema } }),
  });
  renders.set("form", (renders.get("form") ?? 0) + 1);
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.AppForm>
        {counted(
          renders,
          "first",
          <form.AppField name="first">
            {(field) => <field.TextField label="First" description="The first value." />}
          </form.AppField>,
        )}
        {counted(
          renders,
          "second",
          <form.AppField name="second">
            {(field) => <field.TextField label="Second" />}
          </form.AppField>,
        )}
        {counted(renders, "submit", <form.SubmitButton>Save</form.SubmitButton>)}
      </form.AppForm>
    </form>
  );
}

describe("granular subscriptions", () => {
  function typeInFirst(): HTMLElement {
    const first = screen.getByLabelText("First");
    for (const value of ["a", "ab", "abc"]) fireEvent.change(first, { target: { value } });
    return first;
  }

  it("renders only the edited field on a keystroke: not its valid sibling, the submit button or the form", () => {
    const renders = new Map<string, number>();
    render(<TwoFields renders={renders} second="set" />);
    renders.clear();

    const first = typeInFirst();

    expect(first).toHaveProperty("value", "abc");
    expect(renders.get("first")).toBeGreaterThanOrEqual(3);
    expect(renders.get("second")).toBeUndefined();
    expect(renders.get("submit")).toBeUndefined();
    expect(renders.get("form")).toBeUndefined();
  });

  // A form-level onChange schema hands every invalid field a new issue array on each keystroke,
  // which renders it; validating on submit leaves an invalid sibling alone as well.
  it("leaves an invalid, untouched sibling alone when the schema validates on submit", () => {
    const renders = new Map<string, number>();
    render(<TwoFields renders={renders} validateOn="submit" />);
    renders.clear();
    typeInFirst();
    expect(renders.get("first")).toBeGreaterThanOrEqual(3);
    expect(renders.get("second")).toBeUndefined();
    expect(renders.get("submit")).toBeUndefined();
    expect(renders.get("form")).toBeUndefined();
  });
});

describe("the registered fields", () => {
  it("label the control, describe it with its help text and add the error once touched", async () => {
    render(<TwoFields renders={new Map()} />);
    const first = screen.getByLabelText("First");
    const help = screen.getByText("The first value.");
    expect(first.getAttribute("aria-describedby")).toBe(help.id);
    expect(first.getAttribute("aria-invalid")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const error = await screen.findByText("Enter the first value.");
    expect(first.getAttribute("aria-invalid")).toBe("true");
    expect(first.getAttribute("aria-describedby")).toBe(`${help.id} ${error.id}`);
    expect(error.getAttribute("role")).toBe("alert");
    expect(screen.getByLabelText("Second").getAttribute("aria-invalid")).toBe("true");
  });

  it("move focus to the first invalid field on submit and keep the button enabled", async () => {
    render(<TwoFields renders={new Map()} />);
    const save = screen.getByRole("button", { name: "Save" });
    save.focus();
    fireEvent.click(save);
    await screen.findByText("Enter the first value.");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("First")));
    expect(save).toHaveProperty("disabled", false);
  });

  it("keep an error shown after a submit when the field only loses focus", async () => {
    render(<TwoFields renders={new Map()} validateOn="submit" />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Enter the first value.");
    fireEvent.blur(screen.getByLabelText("First"));
    expect(screen.getByText("Enter the first value.")).toBeDefined();
  });

  it("clear a field's error when it is corrected", async () => {
    render(<TwoFields renders={new Map()} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Enter the first value.");

    fireEvent.change(screen.getByLabelText("First"), { target: { value: "a" } });

    expect(screen.queryByText("Enter the first value.")).toBeNull();
    expect(screen.getByText("Enter the second value.")).toBeDefined();
  });
});

function AsyncTitle({ check }: Readonly<{ check: (title: string) => Promise<boolean> }>) {
  const form = useAppForm({
    defaultValues: { title: "" },
    validators: { onChange: z.object({ title: z.string() }) },
  });
  return (
    <form.AppForm>
      <form.AppField
        name="title"
        validators={{
          onChangeAsyncDebounceMs: 50,
          onChangeAsync: async ({ value }) =>
            (await check(value)) ? undefined : `“${value}” is taken.`,
        }}
      >
        {(field) => <field.TextField label="Title" />}
      </form.AppField>
    </form.AppForm>
  );
}

describe("debounced async validation", () => {
  it("checks once after typing stops, shows the check as a status and the answer at the field", async () => {
    let answer: (free: boolean) => void = () => undefined;
    const check = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          answer = resolve;
        }),
    );
    render(<AsyncTitle check={check} />);
    const title = screen.getByLabelText("Title");
    for (const value of ["T", "Ti", "Titration basics"]) {
      fireEvent.change(title, { target: { value } });
    }

    await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
    expect(check).toHaveBeenCalledWith("Titration basics");
    expect(screen.getByRole("status").textContent).toBe("Checking…");

    await act(async () => answer(false));
    expect(await screen.findByText("“Titration basics” is taken.")).toBeDefined();
    expect(title.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("says Checking… in Dutch in the nl locale", async () => {
    overwriteGetLocale(() => "nl");
    render(<AsyncTitle check={() => new Promise(() => undefined)} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "x" } });
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("Bezig met controleren…"),
    );
  });
});

function RefusedForm({ refusal }: Readonly<{ refusal: { form?: string; field?: string } }>) {
  const form = useAppForm({
    defaultValues: { reason: "" },
    validators: { onSubmit: z.object({ reason: z.string() }) },
    onSubmit: ({ formApi }) =>
      applyServerRefusal(formApi, {
        ...(refusal.form ? { form: refusal.form } : {}),
        ...(refusal.field ? { fields: { reason: refusal.field } } : {}),
      }),
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
        <form.FormErrors />
        <form.AppField name="reason">
          {(field) => <field.TextareaField label="Reason" />}
        </form.AppField>
        <form.SubmitButton>Block</form.SubmitButton>
      </form.AppForm>
    </form>
  );
}

describe("server refusals", () => {
  it("shows a refusal of one field at that field, until the next change", async () => {
    render(<RefusedForm refusal={{ field: "This reason is too vague." }} />);
    fireEvent.click(screen.getByRole("button", { name: "Block" }));

    await screen.findByText("This reason is too vague.");
    const reason = screen.getByLabelText("Reason");
    expect(reason.getAttribute("aria-invalid")).toBe("true");

    fireEvent.change(reason, { target: { value: "Account shared" } });
    expect(screen.queryByText("This reason is too vague.")).toBeNull();
  });

  it("shows a refusal of the whole form at the top and moves focus to it", async () => {
    render(<RefusedForm refusal={{ form: "The server refused the form." }} />);
    fireEvent.click(screen.getByRole("button", { name: "Block" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The form was not saved");
    expect(alert.textContent).toContain("The server refused the form.");
    await waitFor(() => expect(document.activeElement).toBe(alert));
  });
});
