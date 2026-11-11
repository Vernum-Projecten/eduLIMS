// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Fictional demo data for the chart example: no real practicals, classes or people.

/** The academic years the demo practicals belong to. */
export const ACADEMIC_YEARS = [1, 2, 3] as const;

export type AcademicYear = (typeof ACADEMIC_YEARS)[number];

/** One fictional practical, as a KPI view might summarise it. */
export interface DemoPractical {
  id: string;
  title: string;
  academicYear: AcademicYear;
  /** Lab reports handed in. */
  submissions: number;
  /** Mean final grade on the 1 to 10 scale, over at least 5 assessments (R-03). */
  averageGrade: number;
  /** Students enrolled in the class. */
  classSize: number;
}

export const DEMO_PRACTICALS: readonly DemoPractical[] = [
  {
    id: "p01",
    title: "Pipetting accuracy",
    academicYear: 1,
    submissions: 22,
    averageGrade: 7.4,
    classSize: 24,
  },
  {
    id: "p02",
    title: "Serial dilutions",
    academicYear: 1,
    submissions: 28,
    averageGrade: 6.8,
    classSize: 32,
  },
  {
    id: "p03",
    title: "Buffer preparation",
    academicYear: 1,
    submissions: 17,
    averageGrade: 6.1,
    classSize: 20,
  },
  {
    id: "p04",
    title: "Protein assay on the Epoch 2",
    academicYear: 1,
    submissions: 35,
    averageGrade: 7.1,
    classSize: 38,
  },
  {
    id: "p05",
    title: "Spectrophotometry basics",
    academicYear: 1,
    submissions: 12,
    averageGrade: 5.9,
    classSize: 16,
  },
  {
    id: "p06",
    title: "HbA1c on the Afinion 2",
    academicYear: 2,
    submissions: 26,
    averageGrade: 7.8,
    classSize: 28,
  },
  {
    id: "p07",
    title: "CRP on the Afinion 2",
    academicYear: 2,
    submissions: 19,
    averageGrade: 6.5,
    classSize: 26,
  },
  {
    id: "p08",
    title: "Enzyme kinetics",
    academicYear: 2,
    submissions: 31,
    averageGrade: 6.2,
    classSize: 34,
  },
  {
    id: "p09",
    title: "ELISA on a 96-well plate",
    academicYear: 2,
    submissions: 14,
    averageGrade: 7.0,
    classSize: 18,
  },
  {
    id: "p10",
    title: "Calibration curves",
    academicYear: 2,
    submissions: 23,
    averageGrade: 8.1,
    classSize: 24,
  },
  {
    id: "p11",
    title: "Method validation",
    academicYear: 3,
    submissions: 9,
    averageGrade: 7.6,
    classSize: 12,
  },
  {
    id: "p12",
    title: "Quality control charts",
    academicYear: 3,
    submissions: 15,
    averageGrade: 8.3,
    classSize: 15,
  },
  {
    id: "p13",
    title: "Measurement uncertainty",
    academicYear: 3,
    submissions: 11,
    averageGrade: 6.9,
    classSize: 14,
  },
  {
    id: "p14",
    title: "Interference study",
    academicYear: 3,
    submissions: 7,
    averageGrade: 7.2,
    classSize: 10,
  },
];
