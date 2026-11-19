// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { JOIN_VIA } from "@/lib/simulations";
import { SIMULATION_ACTION_ERRORS } from "@/server/simulations/access";
import { EMAIL_LINE_STATUSES } from "@/server/simulations/emails";
import {
  emailLineLabel,
  isJoinVia,
  joinViaLabel,
  simulationErrorMessage,
} from "./simulation-labels";

describe("simulationErrorMessage (D10)", () => {
  it.each(SIMULATION_ACTION_ERRORS)("gives refusal %s its own message", (code) => {
    const message = simulationErrorMessage(code);
    expect(message).not.toBe("");
    expect(message).not.toBe(simulationErrorMessage(null));
  });

  it("gives every refusal a different message", () => {
    const messages = SIMULATION_ACTION_ERRORS.map(simulationErrorMessage);
    expect(new Set(messages).size).toBe(messages.length);
  });

  it("names a failure that is no refusal as one to try again", () => {
    expect(simulationErrorMessage(null)).toBe("The change could not be saved. Try again.");
  });

  it("tells a teacher why another account cannot teach", () => {
    expect(simulationErrorMessage("not_a_teacher")).toContain("teacher role");
  });
});

describe("emailLineLabel (D10: the outcome per line before anything is stored)", () => {
  it.each(EMAIL_LINE_STATUSES)("names outcome %s in words", (status) => {
    expect(emailLineLabel({ email: "a@example.test", status })).not.toBe("");
  });

  it("names the other lab of an address that is already in one", () => {
    expect(
      emailLineLabel({
        email: "a@example.test",
        status: "in_other_lab",
        otherLab: { id: "01960000-0000-7000-8000-000000000002", name: "Borealis" },
      }),
    ).toBe("Not added: already in lab Borealis");
  });

  it("still says another lab when the server names none", () => {
    expect(emailLineLabel({ email: "a@example.test", status: "in_other_lab" })).toBe(
      "Not added: already in another lab",
    );
  });

  it("says only a new line is added", () => {
    expect(emailLineLabel({ email: "a@example.test", status: "new" })).toBe("Will be added");
    expect(emailLineLabel({ email: "nope", status: "invalid" })).toMatch(/^Not added/);
  });
});

describe("joinViaLabel", () => {
  it.each(JOIN_VIA)("names how a student came in by %s", (via) => {
    expect(joinViaLabel(via)).not.toBe("");
  });

  it("tells the two ways apart", () => {
    expect(joinViaLabel("email")).not.toBe(joinViaLabel("code"));
  });

  it("recognises only the stored ways", () => {
    expect(isJoinVia("email")).toBe(true);
    expect(isJoinVia("code")).toBe(true);
    expect(isJoinVia("invitation")).toBe(false);
  });
});
