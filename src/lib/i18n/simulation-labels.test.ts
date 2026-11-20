// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { LIMIT_KINDS } from "@/lib/correct-values";
import { JOIN_VIA, SIMULATION_STATES } from "@/lib/simulations";
import { SIMULATION_ACTION_ERRORS } from "@/server/simulations/access";
import { EMAIL_LINE_STATUSES } from "@/server/simulations/emails";
import {
  emailLineLabel,
  isJoinVia,
  joinViaLabel,
  limitKindLabel,
  linkedMessage,
  missingLimitsMessage,
  simulationErrorMessage,
  simulationStateLabel,
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

  it("tells only that no teacher account uses the address (#328)", () => {
    // One answer for an unknown address and for a student's or an administrator's: the message
    // must not reveal that some other account exists.
    expect(simulationErrorMessage("not_a_teacher")).toBe("No teacher account uses this address.");
  });

  it("says a teacher to remove does not teach the simulation, apart from the add refusal", () => {
    expect(simulationErrorMessage("teacher_not_found")).toBe(
      "This person does not teach this simulation.",
    );
  });
});

describe("missingLimitsMessage (maintainer 2026-11-20 on #267)", () => {
  const names = new Map([
    ["a", "Albumin"],
    ["u", "Urea"],
  ]);

  it("names the tests without limits", () => {
    expect(missingLimitsMessage(["a", "u"], names)).toBe(
      "Set the accuracy limits of Albumin, Urea before you start the simulation.",
    );
  });

  it("falls back to the general message when the screen cannot name a test", () => {
    expect(missingLimitsMessage(["a", "x"], names)).toBe(simulationErrorMessage("missing_limits"));
    expect(missingLimitsMessage([], names)).toBe(simulationErrorMessage("missing_limits"));
  });
});

describe("simulationStateLabel and limitKindLabel (D10, D13)", () => {
  it.each(SIMULATION_STATES)("names state %s in words", (state) => {
    expect(simulationStateLabel(state)).not.toBe("");
  });

  it("names each state differently", () => {
    expect(new Set(SIMULATION_STATES.map(simulationStateLabel)).size).toBe(3);
    expect(simulationStateLabel("running")).toBe("Running");
  });

  it.each(LIMIT_KINDS)("names limit kind %s in words", (kind) => {
    expect(limitKindLabel(kind)).not.toBe("");
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

describe("linkedMessage (S10, #290)", () => {
  const lab = (labId: string, labName: string) => ({
    labId,
    labName,
    simulationId: "s1",
    simulationName: "Demo simulation",
    logoVersion: null,
  });
  const aurora = lab("l1", "Lab Aurora");
  const borealis = lab("l2", "Lab Borealis");

  it("says nothing when no address was linked", () => {
    expect(linkedMessage(0, [aurora], [aurora])).toBeNull();
  });

  it("names the one lab a link added", () => {
    expect(linkedMessage(1, [aurora], [aurora, borealis])).toBe(
      "You were added to lab Lab Borealis of Demo simulation.",
    );
  });

  it("counts the labs when more than one was linked", () => {
    expect(linkedMessage(2, [], [aurora, borealis])).toBe("Labs your teacher added you to: 2.");
  });

  it("counts when the labs read again do not show which lab was added", () => {
    expect(linkedMessage(1, [aurora], [aurora])).toBe("Labs your teacher added you to: 1.");
  });
});
