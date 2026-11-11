// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Fictional starting values of the `/dev/forms` page. Fixed ids keep the server render and
// the hydrated page identical.
import type { DemoRubricForm, DemoSessionForm } from "@/server/dev-forms/schemas";

/** A fictional rubric: three criteria, each with its levels and points. */
export const DEMO_RUBRIC: DemoRubricForm = {
  title: "Pipetting technique",
  criteria: [
    {
      id: "accuracy",
      name: "Accuracy",
      levels: [
        { id: "accuracy-1", label: "Insufficient", points: 0 },
        { id: "accuracy-2", label: "Sufficient", points: 2 },
        { id: "accuracy-3", label: "Good", points: 4 },
      ],
    },
    {
      id: "journal",
      name: "Lab journal",
      levels: [
        { id: "journal-1", label: "Incomplete", points: 0 },
        { id: "journal-2", label: "Complete", points: 2 },
      ],
    },
    {
      id: "safety",
      name: "Safe working",
      levels: [
        { id: "safety-1", label: "Not observed", points: 0 },
        { id: "safety-2", label: "Observed", points: 1 },
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
