// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { EMAIL_LIST_MAX, LAB_NAME_MAX, SIMULATION_NAME_MAX } from "../../lib/simulations.ts";
import {
  addTeacherInput,
  createLabInput,
  emailListInput,
  labIdInput,
  moveMemberInput,
  simulationFormSchema,
  simulationIdInput,
} from "./schemas.ts";

const ID = "01960000-0000-7000-8000-000000000001";

describe("the simulation inputs (D10)", () => {
  it("refuses a malformed id before any query runs", () => {
    expect(simulationIdInput.safeParse({ simulationId: "1 or 1=1" }).success).toBe(false);
    expect(labIdInput.safeParse({ labId: "../x" }).success).toBe(false);
    expect(moveMemberInput.safeParse({ simulationId: ID, userId: "u", labId: "x" }).success).toBe(
      false,
    );
  });

  it("trims a name, refuses an empty one in words and holds the length bounds", () => {
    expect(simulationFormSchema.parse({ name: "  Spring run " })).toEqual({ name: "Spring run" });
    const empty = simulationFormSchema.safeParse({ name: "   " });
    expect(empty.error?.issues[0]?.message).toBe("Enter a name for the simulation.");
    expect(
      simulationFormSchema.safeParse({ name: "x".repeat(SIMULATION_NAME_MAX + 1) }).success,
    ).toBe(false);
    expect(createLabInput.safeParse({ simulationId: ID, name: "" }).error?.issues[0]?.message).toBe(
      "Enter a name for the lab.",
    );
    expect(
      createLabInput.safeParse({ simulationId: ID, name: "x".repeat(LAB_NAME_MAX + 1) }).success,
    ).toBe(false);
  });

  it("takes any line of a pasted list, up to the limit: the server classifies each", () => {
    expect(emailListInput.safeParse({ labId: ID, emails: ["not an address"] }).success).toBe(true);
    expect(emailListInput.safeParse({ labId: ID, emails: [] }).success).toBe(false);
    expect(
      emailListInput.safeParse({ labId: ID, emails: Array(EMAIL_LIST_MAX + 1).fill("a@b.test") })
        .success,
    ).toBe(false);
  });

  it("takes a well-formed address for a new teacher", () => {
    expect(addTeacherInput.safeParse({ simulationId: ID, email: " t@example.test " }).success).toBe(
      true,
    );
    expect(addTeacherInput.safeParse({ simulationId: ID, email: "teacher" }).success).toBe(false);
  });
});
