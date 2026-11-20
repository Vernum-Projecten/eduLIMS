// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The breadcrumb trail of nested pages (#381, #384): every matched route that names itself adds
// a linked step, a layout and the page inside it that share a name show once, and nothing else
// a loader returns becomes a step.
import { describe, expect, it } from "vitest";
import { crumbOf, parseTrail, trailOf } from "./breadcrumb-trail.ts";

const SIM = "/teacher/simulations/s1";

describe("trailOf (#381)", () => {
  it("lists a simulation, its labs and a lab, outermost first, each with its address", () => {
    const matches = [
      { pathname: "/teacher", loaderData: undefined },
      { pathname: SIM, loaderData: { crumb: "Demo simulation" } },
      { pathname: `${SIM}/labs`, loaderData: { crumb: "Labs" } },
      { pathname: `${SIM}/labs/l1`, loaderData: { crumb: "Lab Aurora", simulation: "Demo" } },
    ];
    expect(parseTrail(trailOf(matches))).toEqual([
      { label: "Demo simulation", to: SIM },
      { label: "Labs", to: `${SIM}/labs` },
      { label: "Lab Aurora", to: `${SIM}/labs/l1` },
    ]);
  });

  it("shows a layout and the page inside it once when they share a name", () => {
    const matches = [
      { pathname: SIM, loaderData: { crumb: "Demo simulation" } },
      { pathname: `${SIM}/`, loaderData: { crumb: "Demo simulation" } },
    ];
    expect(parseTrail(trailOf(matches))).toEqual([{ label: "Demo simulation", to: SIM }]);
  });

  it("is empty when no route names itself", () => {
    expect(parseTrail(trailOf([{ pathname: "/teacher", loaderData: { rows: [] } }]))).toEqual([]);
  });
});

describe("crumbOf and parseTrail", () => {
  it("reads only a non-empty string crumb", () => {
    expect(crumbOf({ crumb: "Labs" })).toBe("Labs");
    expect(crumbOf({ crumb: "" })).toBeNull();
    expect(crumbOf({ crumb: 3 })).toBeNull();
    expect(crumbOf(null)).toBeNull();
  });

  it("drops what is not a step", () => {
    expect(parseTrail('[{"label":"A","to":"/a"},{"label":1},null]')).toEqual([
      { label: "A", to: "/a" },
    ]);
    expect(parseTrail("{}")).toEqual([]);
  });
});
