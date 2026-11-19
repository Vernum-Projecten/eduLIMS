// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { WellId } from "../../lib/plate.ts";
import { MAX_ERROR_TEXT } from "./limits.ts";
import type { XmlCap } from "./xml.ts";

/**
 * The errors of the file and its archive: the size, the extension, the zip container and the
 * workbook parts. Any one of them ends the parse at once, so the parser returns only the first.
 *
 * A `part` names only a part the workbook reader asked for, cut to {@link MAX_ERROR_TEXT}
 * characters; an error about an arbitrary entry of the archive carries no name (ASVS 5.0 V16.5.1).
 */
export type ArchiveError =
  | { readonly kind: "file_too_large"; readonly size: number; readonly limit: number }
  | { readonly kind: "wrong_extension" }
  | { readonly kind: "not_a_zip" }
  | { readonly kind: "too_many_entries"; readonly count: number; readonly limit: number }
  | { readonly kind: "unpacked_too_large"; readonly size: number; readonly limit: number }
  | {
      readonly kind: "part_too_large";
      readonly part: string;
      readonly size: number;
      readonly limit: number;
    }
  | {
      readonly kind: "entry_size_mismatch";
      /** The part whose content does not match the size its directory entry declares. */
      readonly part?: string;
    }
  | {
      readonly kind: "archive_unsupported";
      readonly reason: "zip64" | "multi_disk" | "encrypted" | "compression_method";
    }
  | {
      readonly kind: "archive_corrupt";
      readonly reason: ArchiveCorruption;
      readonly part?: string;
    }
  | {
      readonly kind: "not_a_workbook";
      /** The workbook part that is missing, of the wrong type or not in the expected shape. */
      readonly part: string;
    }
  | { readonly kind: "xml_malformed"; readonly part: string; readonly offset: number }
  | { readonly kind: "xml_dtd_refused"; readonly part: string }
  | {
      readonly kind: "xml_too_large";
      readonly part: string;
      /** The cap the part passed: its element count, its nesting depth, or one element's attributes. */
      readonly cap: XmlCap;
    };

/** Why the zip container could not be read. */
export type ArchiveCorruption =
  | "end_of_central_directory"
  | "central_directory"
  | "local_header"
  | "entry_overlap"
  | "entry_name"
  | "duplicate_entry"
  | "entry_data"
  | "checksum"
  | "text_encoding";

/** Returns `text` cut to {@link MAX_ERROR_TEXT} characters, without splitting a surrogate pair. */
export function boundText(text: string): string {
  if (text.length <= MAX_ERROR_TEXT) return text;
  const cut = text.slice(0, MAX_ERROR_TEXT);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/** A field of the header block, as {@link Gen5Header} names it, or a field the parser ignores. */
export type HeaderField =
  | "softwareVersion"
  | "plateNumber"
  | "date"
  | "time"
  | "readerType"
  | "readerSerialNumber"
  | "wavelength"
  | "temperature"
  | "experimentFilePath"
  | "protocolFilePath"
  | "readingType"
  | "readSpeed";

/**
 * The errors of the sheet's layout (S4: "a file in another layout is rejected with a clear error
 * message"). Each names the cell or the well in error, so the message can name it (WCAG 2.1 SC
 * 3.3.1); the parser returns every one it finds.
 */
export type LayoutError =
  | { readonly kind: "sheet_count"; readonly count: number }
  | { readonly kind: "label_missing"; readonly cell: string; readonly expected: string }
  | { readonly kind: "header_missing"; readonly field: HeaderField; readonly cell: string }
  | { readonly kind: "header_invalid"; readonly field: HeaderField; readonly cell: string }
  | { readonly kind: "plate_type_unsupported"; readonly cell: string }
  | { readonly kind: "read_type_unsupported"; readonly cell: string }
  | { readonly kind: "read_area_unsupported"; readonly cell: string }
  | { readonly kind: "wavelength_count"; readonly cell: string }
  | { readonly kind: "grid_missing" }
  | { readonly kind: "grid_shape"; readonly cell: string }
  | { readonly kind: "wavelength_mismatch"; readonly cell: string }
  | { readonly kind: "well_empty"; readonly well: WellId; readonly cell: string }
  | { readonly kind: "well_not_a_number"; readonly well: WellId; readonly cell: string }
  | { readonly kind: "unexpected_content"; readonly cell: string };

/** Every reason the Gen5 parser refuses a file. */
export type Gen5Error = ArchiveError | LayoutError;

/** A result of a step that can fail with one archive error. */
export type Step<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ArchiveError };

/** Returns a successful step. */
export function stepOk<T>(value: T): Step<T> {
  return { ok: true, value };
}

/** Returns a failed step. */
export function stepFail<T>(error: ArchiveError): Step<T> {
  return { ok: false, error };
}
