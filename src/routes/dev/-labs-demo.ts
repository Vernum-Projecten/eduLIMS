// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Fictional demo data for the chart example: invented labs and numbers, no real simulation,
// team or person. The mean is a demo figure, not a definition of a dashboard measure.

/** The simulations the demo labs belong to. */
export const SIMULATIONS = [1, 2, 3] as const;

export type DemoSimulation = (typeof SIMULATIONS)[number];

/** One fictional lab, as a chart of a simulation might summarise it. */
export interface DemoLab {
  id: string;
  name: string;
  simulation: DemoSimulation;
  /** Results the lab released. */
  released: number;
  /** Mean minutes between the entry of a request and the release of its result. */
  turnaround: number;
  /** Requests the lab recorded. */
  requests: number;
}

export const DEMO_LABS: readonly DemoLab[] = [
  { id: "l01", name: "Lab Amber", simulation: 1, released: 22, turnaround: 38.4, requests: 24 },
  { id: "l02", name: "Lab Birch", simulation: 1, released: 28, turnaround: 45.2, requests: 32 },
  { id: "l03", name: "Lab Cedar", simulation: 1, released: 17, turnaround: 52.9, requests: 20 },
  { id: "l04", name: "Lab Dune", simulation: 1, released: 35, turnaround: 41.7, requests: 38 },
  { id: "l05", name: "Lab Ember", simulation: 1, released: 12, turnaround: 60.3, requests: 16 },
  { id: "l06", name: "Lab Fjord", simulation: 2, released: 26, turnaround: 33.8, requests: 28 },
  { id: "l07", name: "Lab Garnet", simulation: 2, released: 19, turnaround: 48.6, requests: 26 },
  { id: "l08", name: "Lab Heron", simulation: 2, released: 31, turnaround: 55.1, requests: 34 },
  { id: "l09", name: "Lab Iris", simulation: 2, released: 14, turnaround: 39.5, requests: 18 },
  { id: "l10", name: "Lab Juniper", simulation: 2, released: 23, turnaround: 29.4, requests: 24 },
  { id: "l11", name: "Lab Kestrel", simulation: 3, released: 9, turnaround: 36.2, requests: 12 },
  { id: "l12", name: "Lab Lumen", simulation: 3, released: 15, turnaround: 27.6, requests: 15 },
  { id: "l13", name: "Lab Maple", simulation: 3, released: 11, turnaround: 43.9, requests: 14 },
  { id: "l14", name: "Lab Nimbus", simulation: 3, released: 7, turnaround: 50.7, requests: 10 },
];
