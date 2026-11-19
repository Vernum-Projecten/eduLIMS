// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// NOTE: ASVS 5.0 V5.1.1, V5.2.1, V5.2.3, V15.2.2; the maintainer's decisions of 2026-11-19 (#153,
// the security review of #297). The supplied export is 9,593 bytes and 38,586 bytes unpacked.

/** The largest Gen5 export eduLIMS reads, in bytes (1 MiB), checked before any parsing. */
export const MAX_UPLOAD_BYTES = 1_048_576;

/** The largest total unpacked size of the archive's entries, in bytes (8 MiB). */
export const MAX_UNPACKED_BYTES = 8_388_608;

/** The largest unpacked size of one part the reader opens, in bytes (1 MiB). */
export const MAX_PART_BYTES = 1_048_576;

/** The most entries the archive may hold. */
export const MAX_ARCHIVE_ENTRIES = 50;

/** The most elements one XML part may hold, the root included. */
export const MAX_XML_ELEMENTS = 5_000;

/** The deepest nesting of elements in one XML part; the root is at depth 1. */
export const MAX_XML_DEPTH = 32;

/** The most attributes one XML element may carry, namespace declarations included. */
export const MAX_XML_ATTRIBUTES = 32;

/** The longest text from the file that an error carries; longer text is cut to this length. */
export const MAX_ERROR_TEXT = 128;

/** The one file extension the upload accepts, compared without regard to case. */
export const GEN5_EXTENSION = ".xlsx";
