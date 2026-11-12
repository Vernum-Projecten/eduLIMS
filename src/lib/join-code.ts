// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The join code of a class (#49): the fallback for a student who signs in with another address
// than the one a teacher invited (owner decision on #28). Pure rules shared by the forms and the
// server: the alphabet, the shape, the normalisation and the teacher's bounds.

// NOTE: #49; no 0/O, 1/I/L: a code read off a projector or a slide is typed without a mix-up.
/** The 31 symbols of a join code: digits 2 to 9 and the capitals without I, L and O. */
export const JOIN_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

// NOTE: #49 asks for at least 40 bits; 10 symbols of 31 give log2(31^10), about 49.5 bits.
/** The number of symbols in a join code. */
export const JOIN_CODE_LENGTH = 10;

/** The symbols per group when a code is shown ("ABCDE-FGHJK"). */
export const JOIN_CODE_GROUP = 5;

// NOTE: no requirement governs these bounds: our own design, flagged on #49 for the owner.
/** The days a new code is valid by default, and the most a teacher may choose. */
export const JOIN_CODE_DAYS_DEFAULT = 7;
export const JOIN_CODE_DAYS_MAX = 30;
/** The joins a new code allows by default, and the most a teacher may choose. */
export const JOIN_CODE_USES_DEFAULT = 100;
export const JOIN_CODE_USES_MAX = 500;

/**
 * Returns a new join code drawn with `randomIndex`, which must return a uniform integer in
 * `[0, max)` from a cryptographic source (`crypto.randomInt` on the server).
 */
export function generateJoinCode(randomIndex: (max: number) => number): string {
  let code = "";
  for (let i = 0; i < JOIN_CODE_LENGTH; i += 1) {
    const symbol = JOIN_CODE_ALPHABET[randomIndex(JOIN_CODE_ALPHABET.length)];
    if (symbol === undefined) throw new RangeError("randomIndex returned an index out of range");
    code += symbol;
  }
  return code;
}

/**
 * Returns a typed code in its stored form (capitals, no spaces or dashes), or `null` when it
 * cannot be a join code: a wrong length or a symbol outside {@link JOIN_CODE_ALPHABET}.
 */
export function normalizeJoinCode(typed: string): string | null {
  const code = typed.replace(/[\s-]/g, "").toUpperCase();
  if (code.length !== JOIN_CODE_LENGTH) return null;
  for (const symbol of code) if (!JOIN_CODE_ALPHABET.includes(symbol)) return null;
  return code;
}

/** Returns a code in groups for reading aloud and typing ("ABCDE-FGHJK"). */
export function formatJoinCode(code: string): string {
  const groups: string[] = [];
  for (let i = 0; i < code.length; i += JOIN_CODE_GROUP) {
    groups.push(code.slice(i, i + JOIN_CODE_GROUP));
  }
  return groups.join("-");
}

/** The minutes of the window in which wrong codes count against a student and an address. */
export const JOIN_LIMIT_WINDOW_MINUTES = 15;

/** The longest typed code the join form takes: the code, its dashes and some spaces. */
export const JOIN_CODE_INPUT_MAX = 32;
