// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

/** The analytes the demo rows cycle through (Afinion 2 HbA1c and CRP, Epoch 2 absorbance). */
export const DEMO_ANALYTES = ["hba1c", "crp", "absorbance"] as const;

/** One fictional measurement row of the `/dev/virtual` demo; no person, only a sample ID. */
export interface DemoRow {
  /** Stable key and visible sample ID, `VD-00001` upward. */
  id: string;
  analyte: (typeof DEMO_ANALYTES)[number];
  /** Value in the analyte's unit, two decimals. */
  value: number;
  inRange: boolean;
  /** Every ninth row carries a note, so rows differ in height. */
  hasNote: boolean;
}

/**
 * Returns `count` deterministic fictional rows: the same input always gives the same rows, so
 * the server render and the hydration render agree and tests can name a row.
 */
export function demoRows(count: number): DemoRow[] {
  return Array.from({ length: count }, (_, index) => {
    const analyte = DEMO_ANALYTES[index % DEMO_ANALYTES.length] ?? "hba1c";
    // A fixed integer hash spreads values without randomness.
    const spread = ((index * 7919) % 1000) / 1000;
    const value = Math.round((analyte === "absorbance" ? spread * 2 : 4 + spread * 6) * 100) / 100;
    return {
      id: `VD-${String(index + 1).padStart(5, "0")}`,
      analyte,
      value,
      inRange: (index * 31) % 10 !== 0,
      hasNote: index % 9 === 4,
    };
  });
}
