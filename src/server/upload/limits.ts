// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// NOTE: ASVS 5.0 V5.1.1, V5.2.1, V5.2.3; the maintainer's engineering decision of 2026-11-19 (#153).

/** The largest Gen5 export eduLIMS reads, in bytes (1 MiB), checked before any parsing. */
export const MAX_UPLOAD_BYTES = 1_048_576;

/** The largest total unpacked size of the archive's entries, in bytes (8 MiB). */
export const MAX_UNPACKED_BYTES = 8_388_608;

/** The most entries the archive may hold. */
export const MAX_ARCHIVE_ENTRIES = 50;

/** The one file extension the upload accepts, compared without regard to case. */
export const GEN5_EXTENSION = ".xlsx";
