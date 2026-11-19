// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Reads a zip archive held in memory (PKWARE APPNOTE.TXT 6.3.10, §4.3): the end of central
// directory record, the central directory, and one entry at a time on request. Entry names are
// lookup keys only and never touch the file system (ASVS 5.0 V5.3.2).
import { crc32, inflateRawSync } from "node:zlib";
import { type ArchiveError, type Step, stepFail, stepOk } from "./errors.ts";

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const END_RECORD_LENGTH = 22;
const CENTRAL_HEADER_LENGTH = 46;
const LOCAL_HEADER_LENGTH = 30;
const MAX_COMMENT_LENGTH = 0xffff;
/** General purpose flags (§4.4.4): bit 0 encrypted, bit 6 strong encryption, bit 13 masked. */
const ENCRYPTION_FLAGS = 0x0001 | 0x0040 | 0x2000;
const STORED = 0;
const DEFLATED = 8;

/** One entry of the central directory. */
export interface ZipEntry {
  readonly name: string;
  readonly method: typeof STORED | typeof DEFLATED;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
}

/** A zip archive whose central directory passed every check, with its bytes. */
export interface ZipDirectory {
  readonly entries: ReadonlyMap<string, ZipEntry>;
  readonly bytes: Uint8Array;
  readonly centralDirectoryOffset: number;
}

/** The limits {@link readZipDirectory} enforces before any entry is unpacked (ASVS V5.2.3). */
export interface ZipLimits {
  readonly maxEntries: number;
  readonly maxUnpackedBytes: number;
}

/** Returns true when `bytes` starts with a local file header signature (`PK\x03\x04`). */
export function hasZipSignature(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true) ===
      LOCAL_HEADER_SIGNATURE
  );
}

function corrupt<T>(reason: "end_of_central_directory" | "central_directory"): Step<T> {
  return stepFail({ kind: "archive_corrupt", reason });
}

function findEndRecord(view: DataView): number | undefined {
  const last = view.byteLength - END_RECORD_LENGTH;
  const first = Math.max(0, last - MAX_COMMENT_LENGTH);
  for (let offset = last; offset >= first; offset -= 1) {
    if (view.getUint32(offset, true) !== END_SIGNATURE) continue;
    // NOTE: APPNOTE §4.3.16; the comment must end the file exactly, so trailing bytes are refused.
    if (offset + END_RECORD_LENGTH + view.getUint16(offset + 20, true) === view.byteLength) {
      return offset;
    }
  }
  return undefined;
}

const nameDecoder = new TextDecoder("utf-8", { fatal: true });

function decodeName(bytes: Uint8Array): string | undefined {
  try {
    const name = nameDecoder.decode(bytes);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: a name with a control character is refused.
    return name.length > 0 && !/[\u0000-\u001f\u007f]/.test(name) ? name : undefined;
  } catch {
    // NOTE: no specification governs this: our own design; a name that is not UTF-8 is refused.
    return undefined;
  }
}

/**
 * Reads and checks the central directory of `bytes` without unpacking anything.
 *
 * The entry count and the sum of the declared unpacked sizes are checked against `limits` before
 * any entry is read (ASVS 5.0 V5.2.3). ZIP64, split archives, encryption and any compression
 * method other than stored and deflate are refused.
 */
export function readZipDirectory(bytes: Uint8Array, limits: ZipLimits): Step<ZipDirectory> {
  if (bytes.length < END_RECORD_LENGTH) return stepFail({ kind: "not_a_zip" });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEndRecord(view);
  if (end === undefined) return corrupt("end_of_central_directory");

  const diskNumber = view.getUint16(end + 4, true);
  const centralDisk = view.getUint16(end + 6, true);
  const entriesOnDisk = view.getUint16(end + 8, true);
  const entryCount = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const centralOffset = view.getUint32(end + 16, true);

  if (
    entryCount === 0xffff ||
    entriesOnDisk === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    return stepFail({ kind: "archive_unsupported", reason: "zip64" });
  }
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    return stepFail({ kind: "archive_unsupported", reason: "multi_disk" });
  }
  if (entryCount > limits.maxEntries) {
    return stepFail({ kind: "too_many_entries", count: entryCount, limit: limits.maxEntries });
  }
  if (entryCount === 0 || centralOffset + centralSize !== end) {
    return corrupt("central_directory");
  }

  const entries = new Map<string, ZipEntry>();
  let declaredTotal = 0;
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + CENTRAL_HEADER_LENGTH > end) return corrupt("central_directory");
    if (view.getUint32(offset, true) !== CENTRAL_HEADER_SIGNATURE) {
      return corrupt("central_directory");
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const checksum = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const startDisk = view.getUint16(offset + 34, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nameStart = offset + CENTRAL_HEADER_LENGTH;
    const next = nameStart + nameLength + extraLength + commentLength;
    if (next > end) return corrupt("central_directory");

    const name = decodeName(bytes.subarray(nameStart, nameStart + nameLength));
    if (name === undefined) return stepFail({ kind: "archive_corrupt", reason: "entry_name" });
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      return stepFail({ kind: "archive_unsupported", reason: "zip64", part: name });
    }
    if (startDisk !== 0) {
      return stepFail({ kind: "archive_unsupported", reason: "multi_disk", part: name });
    }
    if ((flags & ENCRYPTION_FLAGS) !== 0) {
      return stepFail({ kind: "archive_unsupported", reason: "encrypted", part: name });
    }
    if (method !== STORED && method !== DEFLATED) {
      return stepFail({ kind: "archive_unsupported", reason: "compression_method", part: name });
    }
    if (method === STORED && compressedSize !== uncompressedSize) {
      return stepFail({ kind: "entry_size_mismatch", part: name });
    }
    if (localHeaderOffset + LOCAL_HEADER_LENGTH > centralOffset) {
      return stepFail({ kind: "archive_corrupt", reason: "local_header", part: name });
    }
    if (entries.has(name)) {
      return stepFail({ kind: "archive_corrupt", reason: "duplicate_entry", part: name });
    }
    declaredTotal += uncompressedSize;
    entries.set(name, {
      name,
      method,
      crc32: checksum,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    offset = next;
  }
  if (offset !== end) return corrupt("central_directory");
  if (declaredTotal > limits.maxUnpackedBytes) {
    return stepFail({
      kind: "unpacked_too_large",
      size: declaredTotal,
      limit: limits.maxUnpackedBytes,
    });
  }
  return stepOk({ entries, bytes, centralDirectoryOffset: centralOffset });
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function inflate(data: Uint8Array, entry: ZipEntry): Step<Uint8Array> {
  try {
    // NOTE: ASVS 5.0 V5.2.3; inflation stops once the output passes the declared size.
    return stepOk(inflateRawSync(data, { maxOutputLength: Math.max(1, entry.uncompressedSize) }));
  } catch (error) {
    const tooLarge =
      error instanceof RangeError && "code" in error && error.code === "ERR_BUFFER_TOO_LARGE";
    const failure: ArchiveError = tooLarge
      ? { kind: "entry_size_mismatch", part: entry.name }
      : { kind: "archive_corrupt", reason: "entry_data", part: entry.name };
    return stepFail(failure);
  }
}

/**
 * Unpacks one entry of a checked directory.
 *
 * The local header must agree with the central directory, the data must lie before the central
 * directory, and the unpacked bytes must match the declared size and CRC-32 exactly. A deflate
 * stream that unpacks past its declared size is refused when it passes it, so a small entry that
 * claims a small size cannot expand without bound (ASVS 5.0 V5.2.3).
 */
export function readZipEntry(directory: ZipDirectory, entry: ZipEntry): Step<Uint8Array> {
  const { bytes, centralDirectoryOffset } = directory;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = entry.localHeaderOffset;
  const localFailure: ArchiveError = {
    kind: "archive_corrupt",
    reason: "local_header",
    part: entry.name,
  };
  if (view.getUint32(at, true) !== LOCAL_HEADER_SIGNATURE) return stepFail(localFailure);
  const method = view.getUint16(at + 8, true);
  const nameLength = view.getUint16(at + 26, true);
  const extraLength = view.getUint16(at + 28, true);
  const nameStart = at + LOCAL_HEADER_LENGTH;
  const dataStart = nameStart + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (method !== entry.method || dataEnd > centralDirectoryOffset) return stepFail(localFailure);
  const localName = bytes.subarray(nameStart, nameStart + nameLength);
  if (!sameBytes(localName, new TextEncoder().encode(entry.name))) return stepFail(localFailure);

  const data = bytes.subarray(dataStart, dataEnd);
  const unpacked = entry.method === STORED ? stepOk(data) : inflate(data, entry);
  if (!unpacked.ok) return unpacked;
  if (unpacked.value.length !== entry.uncompressedSize) {
    return stepFail({ kind: "entry_size_mismatch", part: entry.name });
  }
  if (crc32(unpacked.value) !== entry.crc32) {
    return stepFail({ kind: "archive_corrupt", reason: "checksum", part: entry.name });
  }
  return unpacked;
}
