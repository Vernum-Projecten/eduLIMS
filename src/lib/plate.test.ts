// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { plateWells, wellId } from "./plate.ts";

describe("plate wells", () => {
  it("names a well by row and column", () => {
    expect(wellId("C", 7)).toBe("C7");
  });

  it("lists 96 wells in reading order", () => {
    const wells = plateWells();
    expect(wells).toHaveLength(96);
    expect(wells.slice(0, 2).map((well) => well.well)).toEqual(["A1", "A2"]);
    expect(wells[12]?.well).toBe("B1");
    expect(wells.at(-1)?.well).toBe("H12");
  });
});
