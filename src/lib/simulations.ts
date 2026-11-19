// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Simulations and their labs (D10, S10, ADR 0021): the branded ids that keep a lab id out of a
// simulation id's place, and the bounds both the forms and the server check.
import { z } from "zod";

declare const simulationIdBrand: unique symbol;
declare const labIdBrand: unique symbol;

/** The id of a simulation; never interchangeable with a lab id (R-01). */
export type SimulationId = string & { readonly [simulationIdBrand]: true };

/** The id of a lab; never interchangeable with a simulation id (R-01). */
export type LabId = string & { readonly [labIdBrand]: true };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Returns `value` as a {@link SimulationId} when it is a UUID in its text form, else `null`. */
export function parseSimulationId(value: string): SimulationId | null {
  return UUID.test(value) ? (value as SimulationId) : null;
}

/** Returns `value` as a {@link LabId} when it is a UUID in its text form, else `null`. */
export function parseLabId(value: string): LabId | null {
  return UUID.test(value) ? (value as LabId) : null;
}

// NOTE: no requirement governs these bounds: our own design (#280), held by the database CHECKs.
/** The most characters a simulation name takes. */
export const SIMULATION_NAME_MAX = 100;
/** The most characters a lab name takes. */
export const LAB_NAME_MAX = 60;
/** The most lines one pasted list of email addresses takes. */
export const EMAIL_LIST_MAX = 500;
/** The most characters one line of a pasted list takes (RFC 5321 §4.5.3.1 path limit plus room). */
export const EMAIL_LINE_MAX = 320;

/** How a student came into a lab: their address was on its list, or they used its code. */
export const JOIN_VIA = ["email", "code"] as const;
export type JoinVia = (typeof JOIN_VIA)[number];

/** Returns an email address in the one form the lists store and compare: trimmed, lower case. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;
const ADDRESS = z.email();

/**
 * Returns whether `value`, as an identity provider sent it, is a plain ASCII email address. Only
 * such an address may match a lab's list: lower-casing folds some non-ASCII letters onto ASCII
 * ones (U+212A KELVIN SIGN becomes `k`), so another address could claim a waiting place.
 */
export function isAsciiEmail(value: string): boolean {
  return PRINTABLE_ASCII.test(value) && ADDRESS.safeParse(value).success;
}
