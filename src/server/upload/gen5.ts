// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import "@tanstack/react-start/server-only";
import type { Gen5Error } from "./errors.ts";
import { type Gen5Plate, readGen5Layout } from "./gen5-layout.ts";
import {
  GEN5_EXTENSION,
  MAX_ARCHIVE_ENTRIES,
  MAX_UNPACKED_BYTES,
  MAX_UPLOAD_BYTES,
} from "./limits.ts";
import { readWorkbook } from "./workbook.ts";
import { hasZipSignature, readZipDirectory } from "./zip.ts";

export type { CellNumber } from "./decimal.ts";
export type { ArchiveError, Gen5Error, HeaderField, LayoutError } from "./errors.ts";
export type { Gen5Header, Gen5Plate, PlateWell } from "./gen5-layout.ts";

/** An uploaded file: the name the browser sent and its bytes, held in memory. */
export interface Gen5Upload {
  /** Read only for its extension; never used as a path (ASVS 5.0 V5.3.2). */
  readonly fileName: string;
  readonly bytes: Uint8Array;
}

/** The result of {@link parseGen5Export}: the plate, or at least one typed error. */
export type Gen5ParseResult =
  | { readonly ok: true; readonly plate: Gen5Plate }
  | { readonly ok: false; readonly errors: readonly [Gen5Error, ...Gen5Error[]] };

function refuse(error: Gen5Error): Gen5ParseResult {
  return { ok: false, errors: [error] };
}

/**
 * Parses a Gen5 export of an Epoch 2 plate into its header and its 96 wells (S4).
 *
 * A pure function of the bytes: no file system, database or network. The checks run in this
 * order, and the first file or archive error ends the parse: the size before anything else
 * (ASVS 5.0 V5.2.1), the `.xlsx` extension and the zip signature (V5.2.2), the entry count and the
 * declared unpacked size before any entry is unpacked (V5.2.3), each unpacked entry against its
 * declared size and CRC-32, the workbook content type (V5.2.2), and the XML with any DTD refused
 * (V1.5.1). The layout errors of the sheet are returned together, each naming its cell or well.
 */
export function parseGen5Export(upload: Gen5Upload): Gen5ParseResult {
  const { bytes, fileName } = upload;
  if (bytes.length > MAX_UPLOAD_BYTES) {
    return refuse({ kind: "file_too_large", size: bytes.length, limit: MAX_UPLOAD_BYTES });
  }
  if (!fileName.toLowerCase().endsWith(GEN5_EXTENSION)) return refuse({ kind: "wrong_extension" });
  if (!hasZipSignature(bytes)) return refuse({ kind: "not_a_zip" });

  const zip = readZipDirectory(bytes, {
    maxEntries: MAX_ARCHIVE_ENTRIES,
    maxUnpackedBytes: MAX_UNPACKED_BYTES,
  });
  if (!zip.ok) return refuse(zip.error);
  const workbook = readWorkbook(zip.value);
  if (!workbook.ok) return refuse(workbook.error);
  const layout = readGen5Layout(workbook.sheet);
  return layout.ok ? { ok: true, plate: layout.plate } : layout;
}
