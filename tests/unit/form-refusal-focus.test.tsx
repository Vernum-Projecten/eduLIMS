// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom

// Focus after a server refusal that arrives once the submit has gone out (#120, WCAG 3.3.1):
// a field refusal takes focus to the first field it marks, a form refusal to `FormErrors`.
import { revalidateLogic } from "@tanstack/react-form";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { useAppForm } from "@/components/form/app-form";
import { applyServerRefusal, type ServerRefusal } from "@/lib/forms/server-refusal";

afterEach(cleanup);

interface Values {
  model: string;
  serial: string;
}

/** Answers each submit after a server round trip, with the refusal the test hands it. */
function AsyncRefusalForm({ refusal }: Readonly<{ refusal: ServerRefusal<Values> }>) {
  const form = useAppForm({
    defaultValues: { model: "Abbott Afinion 2", serial: "AF2-DEMO-0001" },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: z.object({ model: z.string().min(1), serial: z.string().min(1) }) },
    onSubmit: async ({ formApi }) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      applyServerRefusal(formApi, refusal);
    },
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
        <form.FormErrors title={null} />
        <form.AppField name="model">{(field) => <field.TextField label="Model" />}</form.AppField>
        <form.AppField name="serial">{(field) => <field.TextField label="Serial" />}</form.AppField>
        <form.SubmitButton>Add</form.SubmitButton>
      </form.AppForm>
    </form>
  );
}

function clickSubmit(): HTMLElement {
  const add = screen.getByRole("button", { name: "Add" });
  add.focus();
  fireEvent.click(add);
  return add;
}

describe("focus after an asynchronous server refusal (#120)", () => {
  it("moves focus to the field the refusal marks", async () => {
    render(<AsyncRefusalForm refusal={{ fields: { serial: "This serial is taken." } }} />);
    const add = clickSubmit();
    expect(document.activeElement).toBe(add);
    await screen.findByText("This serial is taken.");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Serial")));
  });

  it("moves focus to the field again when a resend is refused again", async () => {
    render(<AsyncRefusalForm refusal={{ fields: { serial: "This serial is taken." } }} />);
    clickSubmit();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Serial")));
    clickSubmit();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Serial")));
  });

  it("leaves focus to the form refusal when there is one", async () => {
    render(
      <AsyncRefusalForm
        refusal={{ form: "The register is unavailable.", fields: { serial: "Check this." } }}
      />,
    );
    clickSubmit();
    const message = await screen.findByText("The register is unavailable.");
    const alert = message.closest('[role="alert"]');
    await waitFor(() => expect(document.activeElement).toBe(alert));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.activeElement).toBe(alert);
  });
});
