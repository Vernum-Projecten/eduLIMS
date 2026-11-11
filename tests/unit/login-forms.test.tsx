// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom

// The login forms on the form foundation (#84, S1): an error stays after a blur, and a server
// refusal (an unknown institution domain, a provider that refuses the start, wrong credentials,
// a blocked account) shows at its field or at the top of the form, translated.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DevLoginForm } from "@/components/login/dev-login-form";
import { InstitutionEmailForm } from "@/components/login/institution-email-form";

const mocks = vi.hoisted(() => ({
  route: vi.fn(),
  sso: vi.fn(),
  email: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({ useServerFn: () => mocks.route }));
vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ invalidate: mocks.invalidate }) }));
vi.mock("@/lib/session.functions", () => ({ routeInstitutionEmail: vi.fn() }));
vi.mock("@/lib/auth-client", () => ({
  authClient: { signIn: { sso: mocks.sso, email: mocks.email } },
}));

beforeEach(() => {
  // The server renders the page in English, so a sign-in needs no reload into another language.
  document.documentElement.lang = "en";
  for (const mock of Object.values(mocks)) mock.mockReset();
});
afterEach(cleanup);

function submit(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

describe("InstitutionEmailForm", () => {
  const label = "Institution email address";

  it("keeps the field error after the field loses focus", async () => {
    render(<InstitutionEmailForm redirectTo={undefined} />);
    submit("Continue");
    const input = await screen.findByLabelText(label);
    await waitFor(() => expect(input.getAttribute("aria-invalid")).toBe("true"));
    fireEvent.blur(input);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("valid email address");
    expect(mocks.route).not.toHaveBeenCalled();
  });

  it("shows an unknown domain at the field, and the next change clears it", async () => {
    mocks.route.mockResolvedValueOnce({ providerId: null });
    render(<InstitutionEmailForm redirectTo={undefined} />);
    const input = screen.getByLabelText(label);
    fireEvent.change(input, { target: { value: "someone@unknown.example.test" } });
    submit("Continue");
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("eduLIMS does not know this address"),
    );
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(mocks.sso).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "someone@unknown.example.tes" } });
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("shows a disabled provider at the top of the form", async () => {
    mocks.route.mockResolvedValueOnce({ providerId: "keycloak" });
    mocks.sso.mockResolvedValueOnce({ error: { code: "PROVIDER_DISABLED" } });
    render(<InstitutionEmailForm redirectTo="/teacher" />);
    fireEvent.change(screen.getByLabelText(label), {
      target: { value: "teacher@example.test" },
    });
    submit("Continue");
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "This sign-in option is switched off",
      ),
    );
    expect(mocks.sso).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "keycloak",
        callbackURL: "/login?redirect=%2Fteacher",
      }),
    );
  });

  it("shows a failed address check at the top of the form, and the user can try again", async () => {
    mocks.route.mockRejectedValueOnce(new Error("HTTP 500"));
    render(<InstitutionEmailForm redirectTo={undefined} />);
    const input = screen.getByLabelText(label);
    fireEvent.change(input, { target: { value: "teacher@example.test" } });
    submit("Continue");
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "eduLIMS could not check this address. Try again.",
      ),
    );
    // The address itself is fine: the field is not marked invalid.
    expect(input.getAttribute("aria-invalid")).toBe("false");
    expect(mocks.sso).not.toHaveBeenCalled();

    mocks.route.mockResolvedValueOnce({ providerId: "keycloak" });
    mocks.sso.mockResolvedValueOnce({ error: null });
    submit("Continue");
    await waitFor(() => expect(mocks.sso).toHaveBeenCalledOnce());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("DevLoginForm", () => {
  function fill(email: string, password: string) {
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: email } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  }

  it("keeps both field errors after a blur and does not call the server", async () => {
    render(<DevLoginForm demoAccounts={null} />);
    submit("Sign in with a test account");
    const email = screen.getByLabelText("Email address");
    const password = screen.getByLabelText("Password");
    await waitFor(() => expect(password.getAttribute("aria-invalid")).toBe("true"));
    fireEvent.blur(email);
    fireEvent.blur(password);
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(password.getAttribute("aria-invalid")).toBe("true");
    expect(mocks.email).not.toHaveBeenCalled();
  });

  it("shows wrong credentials at the top of the form, without a title", async () => {
    mocks.email.mockResolvedValueOnce({ error: { code: "INVALID_EMAIL_OR_PASSWORD" } });
    render(<DevLoginForm demoAccounts={null} />);
    fill("student@example.test", "wrong");
    submit("Sign in with a test account");
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(
        /^Incorrect email address or password\.$/,
      ),
    );
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });

  it("shows a blocked account at the top of the form", async () => {
    mocks.email.mockResolvedValueOnce({ error: { code: "BANNED_USER" } });
    render(<DevLoginForm demoAccounts={null} />);
    fill("blocked@example.test", "eduLIMS-dev-only");
    submit("Sign in with a test account");
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Your account is blocked. Contact an administrator.",
      ),
    );
  });

  it("lets the router redirect after a sign-in", async () => {
    mocks.email.mockResolvedValueOnce({ error: null });
    render(<DevLoginForm demoAccounts={null} />);
    fill("student@example.test", "eduLIMS-dev-only");
    submit("Sign in with a test account");
    await waitFor(() => expect(mocks.invalidate).toHaveBeenCalledOnce());
    expect(mocks.email).toHaveBeenCalledWith({
      email: "student@example.test",
      password: "eduLIMS-dev-only",
    });
  });
});
