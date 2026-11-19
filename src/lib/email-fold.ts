// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The fold collision of an e-mail address (#324; ASVS 5.0 V6.8.1). better-auth lower-cases an
// address before eduLIMS reads it or stores it, and lower-casing folds some non-ASCII letters
// onto ASCII ones. Relative imports only: the host CLIs load this in plain Node.

const ASCII = /^\p{ASCII}*$/u;

/**
 * Returns whether `raw`, an address exactly as the identity provider or the directory sent it,
 * is not plain ASCII but its lower-cased form is (U+212A KELVIN SIGN becomes `k`). Such an
 * address would reach eduLIMS as the ASCII address of someone else. An address that stays
 * non-ASCII after lower-casing (`josé@school.example`) is no collision.
 */
export function foldsOntoAscii(raw: string): boolean {
  return !ASCII.test(raw) && ASCII.test(raw.toLowerCase());
}
