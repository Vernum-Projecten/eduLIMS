// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Reads a zip archive held in memory (PKWARE APPNOTE.TXT 6.3.10, §4.3): the end of central
// directory record, the central directory and every local header, and one entry at a time on
// request. Entry names are lookup keys only and never touch the file system (ASVS 5.0 V5.3.2).
import { crc32, inflateRawSync } from "node:zlib";
import { type ArchiveError, boundText, type Step, stepFail, stepOk } from "./errors.ts";

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const END_RECORD_LENGTH = 22;
const CENTRAL_HEADER_LENGTH = 46;
const LOCAL_HEADER_LENGTH = 30;
const MAX_COMMENT_LENGTH = 0xffff;
/** General purpose flags (§4.4.4): bit 0 encrypted, bit 6 strong encryption, bit 13 masked. */
const ENCRYPTION_FLAGS = 0x0001 | 0x0040 | 0x2000;
/** Bit 3: the sizes and CRC-32 follow the data, so the local header may carry zeros (§4.4.4). */
const DATA_DESCRIPTOR_FLAG = 0x0008;
/**
 * The flags a local header must share with its directory entry: encryption, the data descriptor,
 * UTF-8 names and masked headers. Bits 1 and 2 are deflate speed hints and the rest are reserved.
 */
const MEANINGFUL_FLAGS = 0x0001 | 0x0008 | 0x0040 | 0x0800 | 0x2000;
const STORED = 0;
const DEFLATED = 8;

/** One entry of the central directory, with where its data lies. */
export interface ZipEntry {
  readonly name: string;
  readonly method: typeof STORED | typeof DEFLATED;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly dataStart: number;
}

/** A zip archive whose central directory and local headers passed every check, with its bytes. */
export interface ZipDirectory {
  readonly entries: ReadonlyMap<string, ZipEntry>;
  readonly bytes: Uint8Array;
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
    // NOTE: APPNOTE §4.3.16; the last record whose comment ends the file exactly is the one read.
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

interface CentralRecord {
  readonly name: string;
  readonly nameBytes: Uint8Array;
  readonly flags: number;
  readonly method: typeof STORED | typeof DEFLATED;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Checks every local header against its central record and returns where each entry's data
 * lies; entries must not overlap and must end before the central directory.
 */
function locateData(
  view: DataView,
  bytes: Uint8Array,
  records: readonly CentralRecord[],
  centralOffset: number,
): Step<Map<string, ZipEntry>> {
  const localFailure: ArchiveError = { kind: "archive_corrupt", reason: "local_header" };
  const byOffset = [...records].sort((a, b) => a.localHeaderOffset - b.localHeaderOffset);
  const entries = new Map<string, ZipEntry>();
  let previousEnd = 0;
  for (const record of byOffset) {
    const at = record.localHeaderOffset;
    if (at < previousEnd) return stepFail({ kind: "archive_corrupt", reason: "entry_overlap" });
    if (at + LOCAL_HEADER_LENGTH > centralOffset) return stepFail(localFailure);
    if (view.getUint32(at, true) !== LOCAL_HEADER_SIGNATURE) return stepFail(localFailure);
    const flags = view.getUint16(at + 6, true);
    const method = view.getUint16(at + 8, true);
    const checksum = view.getUint32(at + 14, true);
    const compressedSize = view.getUint32(at + 18, true);
    const uncompressedSize = view.getUint32(at + 22, true);
    const nameLength = view.getUint16(at + 26, true);
    const extraLength = view.getUint16(at + 28, true);
    const nameStart = at + LOCAL_HEADER_LENGTH;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + record.compressedSize;
    if (dataEnd > centralOffset) return stepFail(localFailure);
    if (((flags ^ record.flags) & MEANINGFUL_FLAGS) !== 0 || method !== record.method) {
      return stepFail(localFailure);
    }
    if (!sameBytes(bytes.subarray(nameStart, nameStart + nameLength), record.nameBytes)) {
      return stepFail(localFailure);
    }
    // NOTE: APPNOTE §4.4.4 bit 3; without a data descriptor the local sizes and CRC must agree.
    const described = (record.flags & DATA_DESCRIPTOR_FLAG) !== 0;
    const agrees =
      checksum === record.crc32 &&
      compressedSize === record.compressedSize &&
      uncompressedSize === record.uncompressedSize;
    const zeros = checksum === 0 && compressedSize === 0 && uncompressedSize === 0;
    if (!agrees && !(described && zeros)) return stepFail(localFailure);
    entries.set(record.name, {
      name: record.name,
      method: record.method,
      crc32: record.crc32,
      compressedSize: record.compressedSize,
      uncompressedSize: record.uncompressedSize,
      dataStart,
    });
    previousEnd = dataEnd;
  }
  return stepOk(entries);
}

/**
 * Reads and checks the central directory and the local headers of `bytes` without unpacking
 * anything.
 *
 * The entry count and the sum of the declared unpacked sizes are checked against `limits` before
 * any entry is read (ASVS 5.0 V5.2.3). ZIP64, split archives, encryption, any compression method
 * other than stored and deflate, duplicate names, overlapping entries and local headers that
 * disagree with the directory are refused. These errors name no entry (ASVS 5.0 V16.5.1).
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

  const records: CentralRecord[] = [];
  const names = new Set<string>();
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

    const nameBytes = bytes.subarray(nameStart, nameStart + nameLength);
    const name = decodeName(nameBytes);
    if (name === undefined) return stepFail({ kind: "archive_corrupt", reason: "entry_name" });
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      return stepFail({ kind: "archive_unsupported", reason: "zip64" });
    }
    if (startDisk !== 0) return stepFail({ kind: "archive_unsupported", reason: "multi_disk" });
    if ((flags & ENCRYPTION_FLAGS) !== 0) {
      return stepFail({ kind: "archive_unsupported", reason: "encrypted" });
    }
    if (method !== STORED && method !== DEFLATED) {
      return stepFail({ kind: "archive_unsupported", reason: "compression_method" });
    }
    if (method === STORED && compressedSize !== uncompressedSize) {
      return stepFail({ kind: "entry_size_mismatch" });
    }
    if (names.has(name)) return stepFail({ kind: "archive_corrupt", reason: "duplicate_entry" });
    names.add(name);
    declaredTotal += uncompressedSize;
    records.push({
      name,
      nameBytes,
      flags,
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
  const entries = locateData(view, bytes, records, centralOffset);
  if (!entries.ok) return entries;
  return stepOk({ entries: entries.value, bytes });
}

function inflate(data: Uint8Array, entry: ZipEntry, part: string): Step<Uint8Array> {
  try {
    // NOTE: ASVS 5.0 V5.2.3; inflation stops once the output passes the declared size.
    return stepOk(inflateRawSync(data, { maxOutputLength: Math.max(1, entry.uncompressedSize) }));
  } catch (error) {
    const tooLarge =
      error instanceof RangeError && "code" in error && error.code === "ERR_BUFFER_TOO_LARGE";
    const failure: ArchiveError = tooLarge
      ? { kind: "entry_size_mismatch", part }
      : { kind: "archive_corrupt", reason: "entry_data", part };
    return stepFail(failure);
  }
}

/**
 * Unpacks one entry of a checked directory, refusing it when it declares more than `maxBytes`.
 *
 * The declared size is checked against `maxBytes` before inflating, inflation stops once the
 * output passes the declared size (so a small entry that claims a small size cannot expand
 * without bound, ASVS 5.0 V5.2.3), and the result must match the declared size and CRC-32.
 */
export function readZipEntry(
  directory: ZipDirectory,
  entry: ZipEntry,
  maxBytes: number,
): Step<Uint8Array> {
  const part = boundText(entry.name);
  if (entry.uncompressedSize > maxBytes) {
    return stepFail({
      kind: "part_too_large",
      part,
      size: entry.uncompressedSize,
      limit: maxBytes,
    });
  }
  const data = directory.bytes.subarray(entry.dataStart, entry.dataStart + entry.compressedSize);
  const unpacked = entry.method === STORED ? stepOk(data) : inflate(data, entry, part);
  if (!unpacked.ok) return unpacked;
  if (unpacked.value.length !== entry.uncompressedSize) {
    return stepFail({ kind: "entry_size_mismatch", part });
  }
  if (crc32(unpacked.value) !== entry.crc32) {
    return stepFail({ kind: "archive_corrupt", reason: "checksum", part });
  }
  return unpacked;
}
