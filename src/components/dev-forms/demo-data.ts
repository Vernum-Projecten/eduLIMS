// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Fictional starting values of the `/dev/forms` page. Fixed ids keep the server render and
// the hydrated page identical.
import type { DemoRequestForm, DemoSessionForm } from "@/server/dev-forms/schemas";

/** A fictional request: three tests, each with its measurements. */
export const DEMO_REQUEST: DemoRequestForm = {
  sampleNumber: "DEMO-103",
  tests: [
    {
      id: "hba1c",
      name: "HbA1c",
      measurements: [
        { id: "hba1c-1", label: "Run 1", value: 48 },
        { id: "hba1c-2", label: "Run 2", value: 52 },
        { id: "hba1c-3", label: "Run 3", value: 50 },
      ],
    },
    {
      id: "crp",
      name: "CRP",
      measurements: [
        { id: "crp-1", label: "Run 1", value: 12 },
        { id: "crp-2", label: "Run 2", value: 14 },
      ],
    },
    {
      id: "glucose",
      name: "Glucose",
      measurements: [
        { id: "glucose-1", label: "Run 1", value: 5.2 },
        { id: "glucose-2", label: "Repeat", value: 5.4 },
      ],
    },
  ],
};

/** An empty session form. */
export const DEMO_SESSION: DemoSessionForm = {
  name: "",
  notes: "",
  groupSize: Number.NaN,
  analyser: "",
  part: "",
  measurements: [],
  day: "",
  reminder: false,
  observers: [],
  simulateRefusal: false,
};
