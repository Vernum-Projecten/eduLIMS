// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom

// The registered file field (#293): its label, help text and error are wired to the control, a
// chosen file becomes the field's value, a schema refusal and a server refusal show at the field,
// and a reset empties the control.
import { revalidateLogic } from "@tanstack/react-form";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppForm } from "@/components/form/app-form";
import { type LogoForm, logoFormSchema } from "@/components/simulations/logo-form-schema";
import { applyServerRefusal } from "@/lib/forms/server-refusal";

afterEach(cleanup);

const DEFAULTS: LogoForm = { file: null };

function LogoField({
  onSubmit,
}: Readonly<{ onSubmit: (file: File | null, refuse: (message: string) => void) => void }>) {
  const form = useAppForm({
    defaultValues: DEFAULTS,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: logoFormSchema },
    onSubmit: ({ value, formApi }) =>
      onSubmit(value.file, (message) => applyServerRefusal(formApi, { fields: { file: message } })),
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
        <form.AppField name="file">
          {(field) => (
            <field.FileField label="Logo file" description="PNG or JPEG." accept="image/png" />
          )}
        </form.AppField>
        <form.SubmitButton>Upload</form.SubmitButton>
        <button type="button" onClick={() => form.reset()}>
          Reset
        </button>
      </form.AppForm>
    </form>
  );
}

function choose(file: File): HTMLInputElement {
  const input = screen.getByLabelText<HTMLInputElement>("Logo file");
  fireEvent.change(input, { target: { files: [file] } });
  return input;
}

describe("FileField", () => {
  it("is a labelled file control with its help text and accepted types", () => {
    render(<LogoField onSubmit={vi.fn()} />);
    const input = screen.getByLabelText("Logo file");
    expect(input).toHaveProperty("type", "file");
    expect(input.getAttribute("accept")).toBe("image/png");
    const help = screen.getByText("PNG or JPEG.");
    expect(input.getAttribute("aria-describedby")).toBe(help.id);
    expect(input.getAttribute("aria-invalid")).toBe("false");
  });

  it("asks for a file at the field when none is chosen", async () => {
    const onSubmit = vi.fn();
    render(<LogoField onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    const error = await screen.findByText("Choose a PNG or JPEG image.");
    const input = screen.getByLabelText("Logo file");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toContain(error.closest("[id]")?.id ?? "-");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("refuses an SVG at the field before it is sent", async () => {
    const onSubmit = vi.fn();
    render(<LogoField onSubmit={onSubmit} />);
    choose(new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" }));
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    expect(
      await screen.findByText(
        "This file is not a PNG or JPEG image. SVG, GIF and WebP are not accepted.",
      ),
    ).toBeDefined();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("sends the chosen file and shows a server refusal at the field", async () => {
    const file = new File([Uint8Array.of(1)], "logo.png", { type: "image/png" });
    render(
      <LogoField
        onSubmit={(sent, refuse) => {
          expect(sent).toBe(file);
          refuse("This image is larger than 1,024 by 1,024 pixels.");
        }}
      />,
    );
    choose(file);
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    expect(
      await screen.findByText("This image is larger than 1,024 by 1,024 pixels."),
    ).toBeDefined();
    expect(screen.getByLabelText("Logo file").getAttribute("aria-invalid")).toBe("true");
  });

  it("empties the control when the form resets", async () => {
    render(<LogoField onSubmit={vi.fn()} />);
    const input = choose(new File([Uint8Array.of(1)], "logo.png", { type: "image/png" }));
    // jsdom lets a test set `files`, but only an empty string as the value; mark it to see it go.
    Object.defineProperty(input, "value", { configurable: true, writable: true, value: "x" });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    });
    await waitFor(() => expect(input.value).toBe(""));
  });
});
