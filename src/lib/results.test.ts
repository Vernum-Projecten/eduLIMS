// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { parseMeasurementId, parseMeasurementSource, requestedTestState } from "./results.ts";

describe("requestedTestState (the states of a requested test)", () => {
  it("is requested without a measurement, measured with one, released once released", () => {
    expect(requestedTestState(0, false)).toBe("requested");
    expect(requestedTestState(1, false)).toBe("measured");
    expect(requestedTestState(3, false)).toBe("measured");
    expect(requestedTestState(2, true)).toBe("released");
  });
});

describe("parseMeasurementId and parseMeasurementSource", () => {
  it("accept a UUID and the three sources, and nothing else", () => {
    expect(parseMeasurementId("01960000-0000-7000-8000-0000000000a1")).toBe(
      "01960000-0000-7000-8000-0000000000a1",
    );
    expect(parseMeasurementId("nope")).toBeNull();
    expect(parseMeasurementSource("manual")).toBe("manual");
    expect(parseMeasurementSource("epoch_upload")).toBe("epoch_upload");
    expect(parseMeasurementSource("afinion")).toBe("afinion");
    expect(parseMeasurementSource("epoch")).toBeUndefined();
  });
});
