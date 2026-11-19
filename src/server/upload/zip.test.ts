// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { buildZip, type ZipPart } from "../../../tests/fixtures/gen5/xlsx-builder.ts";
import type { Step } from "./errors.ts";
import { hasZipSignature, readZipDirectory, readZipEntry, type ZipDirectory } from "./zip.ts";

const LIMITS = { maxEntries: 50, maxUnpackedBytes: 8 * 1024 * 1024 };
const PART = 1024 * 1024;

function directory(bytes: Uint8Array): ZipDirectory {
  const result = readZipDirectory(bytes, LIMITS);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function errorOf<T>(step: Step<T>) {
  if (step.ok) throw new Error("expected a refusal");
  return step.error;
}

function entryOf(zip: ZipDirectory, name: string) {
  const entry = zip.entries.get(name);
  if (entry === undefined) throw new Error(`no entry ${name}`);
  return entry;
}

/** Offsets of the end record and the first central directory header of a builder zip. */
function layout(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  return { view, end, central: view.getUint32(end + 16, true) };
}

function tamper(parts: readonly ZipPart[], change: (at: ReturnType<typeof layout>) => void) {
  const bytes = buildZip(parts);
  change(layout(bytes));
  return bytes;
}

const ONE: ZipPart[] = [{ name: "a.xml", data: "<a>invented</a>" }];

describe("readZipDirectory", () => {
  it("lists the entries with their declared sizes", () => {
    const zip = directory(buildZip([...ONE, { name: "b.bin", data: "xyz", method: 0 }]));
    expect([...zip.entries.keys()]).toEqual(["a.xml", "b.bin"]);
    expect(entryOf(zip, "b.bin")).toMatchObject({ method: 0, uncompressedSize: 3 });
  });

  it("refuses bytes shorter than an end record", () => {
    expect(errorOf(readZipDirectory(new Uint8Array(10), LIMITS))).toEqual({ kind: "not_a_zip" });
  });

  it("refuses an archive without an end record", () => {
    const bytes = buildZip(ONE).subarray(0, -22);
    expect(errorOf(readZipDirectory(bytes, LIMITS))).toMatchObject({
      reason: "end_of_central_directory",
    });
  });

  it("refuses bytes after the end record", () => {
    const bytes = new Uint8Array([...buildZip(ONE), 0]);
    expect(errorOf(readZipDirectory(bytes, LIMITS))).toMatchObject({
      reason: "end_of_central_directory",
    });
  });

  it("refuses a ZIP64 archive", () => {
    const bytes = tamper(ONE, ({ view, end }) => view.setUint16(end + 10, 0xffff, true));
    expect(errorOf(readZipDirectory(bytes, LIMITS))).toEqual({
      kind: "archive_unsupported",
      reason: "zip64",
    });
  });

  it("refuses a ZIP64 entry", () => {
    const bytes = tamper(ONE, ({ view, central }) =>
      view.setUint32(central + 24, 0xffffffff, true),
    );
    expect(errorOf(readZipDirectory(bytes, LIMITS))).toMatchObject({ reason: "zip64" });
  });

  it("refuses a split archive", () => {
    const bytes = tamper(ONE, ({ view, end }) => view.setUint16(end + 4, 1, true));
    expect(errorOf(readZipDirectory(bytes, LIMITS))).toMatchObject({ reason: "multi_disk" });
  });

  it("refuses an entry that starts on another disk", () => {
    const bytes = tamper(ONE, ({ view, central }) => view.setUint16(central + 34, 1, true));
    expect(errorOf(readZipDirectory(bytes, LIMITS))).toMatchObject({ reason: "multi_disk" });
  });

  it("refuses an encrypted entry", () => {
    const bytes = buildZip([{ name: "a.xml", data: "x", flags: 1 }]);
    expect(errorOf(readZipDirectory(bytes, LIMITS))).toEqual({
      kind: "archive_unsupported",
      reason: "encrypted",
    });
  });

  it("accepts an entry with a data descriptor flag, reading sizes from the directory", () => {
    const zip = directory(buildZip([{ name: "a.xml", data: "<a/>", flags: 0x0008 }]));
    const read = readZipEntry(zip, entryOf(zip, "a.xml"), PART);
    expect(read.ok && new TextDecoder().decode(read.value)).toBe("<a/>");
  });

  it("refuses a compression method other than stored and deflate", () => {
    const bytes = buildZip([{ name: "a.xml", data: "x", method: 12 }]);
    expect(errorOf(readZipDirectory(bytes, LIMITS))).toMatchObject({
      reason: "compression_method",
    });
  });

  it("refuses a stored entry whose sizes disagree", () => {
    const bytes = buildZip([{ name: "a.xml", data: "abc", method: 0, declaredSize: 2 }]);
    expect(errorOf(readZipDirectory(bytes, LIMITS))).toEqual({ kind: "entry_size_mismatch" });
  });

  it("refuses an empty archive", () => {
    expect(errorOf(readZipDirectory(buildZip([]), LIMITS))).toMatchObject({
      reason: "central_directory",
    });
  });

  it("refuses a central directory that does not end at the end record", () => {
    const bytes = tamper(ONE, ({ view, end }) => view.setUint32(end + 12, 10, true));
    expect(errorOf(readZipDirectory(bytes, LIMITS))).toMatchObject({
      reason: "central_directory",
    });
  });

  it("refuses a central header with a wrong signature", () => {
    const bytes = tamper(ONE, ({ view, central }) => view.setUint32(central, 0, true));
    expect(errorOf(readZipDirectory(bytes, LIMITS))).toMatchObject({
      reason: "central_directory",
    });
  });

  it("refuses a central header whose name runs past the directory", () => {
    const bytes = tamper(ONE, ({ view, central }) => view.setUint16(central + 28, 500, true));
    expect(errorOf(readZipDirectory(bytes, LIMITS))).toMatchObject({
      reason: "central_directory",
    });
  });

  it("refuses an entry count larger than the headers present", () => {
    const bytes = tamper(ONE, ({ view, end }) => {
      view.setUint16(end + 8, 2, true);
      view.setUint16(end + 10, 2, true);
    });
    expect(errorOf(readZipDirectory(bytes, LIMITS))).toMatchObject({
      reason: "central_directory",
    });
  });

  it("refuses a name with a control character", () => {
    expect(errorOf(readZipDirectory(buildZip([{ name: "a\u0001", data: "x" }]), LIMITS))).toEqual({
      kind: "archive_corrupt",
      reason: "entry_name",
    });
  });

  it("refuses a name that is not UTF-8", () => {
    const bytes = tamper(ONE, ({ view, central }) => view.setUint8(central + 46, 0xff));
    expect(errorOf(readZipDirectory(bytes, LIMITS))).toMatchObject({ reason: "entry_name" });
  });

  it("refuses two entries with the same name", () => {
    const bytes = buildZip([...ONE, ...ONE]);
    expect(errorOf(readZipDirectory(bytes, LIMITS))).toMatchObject({ reason: "duplicate_entry" });
  });

  it("refuses a local header offset inside the central directory", () => {
    const bytes = tamper(ONE, ({ view, central }) => view.setUint32(central + 42, central, true));
    expect(errorOf(readZipDirectory(bytes, LIMITS))).toMatchObject({ reason: "local_header" });
  });

  it("checks the entry count before reading any header", () => {
    const bytes = tamper(ONE, ({ view, end }) => {
      view.setUint16(end + 8, 51, true);
      view.setUint16(end + 10, 51, true);
    });
    expect(errorOf(readZipDirectory(bytes, LIMITS))).toEqual({
      kind: "too_many_entries",
      count: 51,
      limit: 50,
    });
  });
});

describe("hasZipSignature", () => {
  it("knows a local header signature", () => {
    expect(hasZipSignature(buildZip(ONE))).toBe(true);
    expect(hasZipSignature(new Uint8Array([0x50, 0x4b]))).toBe(false);
  });
});

describe("readZipEntry", () => {
  it("unpacks a deflated entry", () => {
    const zip = directory(buildZip(ONE));
    const read = readZipEntry(zip, entryOf(zip, "a.xml"), PART);
    expect(read.ok && new TextDecoder().decode(read.value)).toBe("<a>invented</a>");
  });

  it("refuses a deflate stream that unpacks past its declared size", () => {
    const zip = directory(
      buildZip([{ name: "a.xml", data: new Uint8Array(32 * 1024 * 1024), declaredSize: 100 }]),
    );
    expect(errorOf(readZipEntry(zip, entryOf(zip, "a.xml"), PART))).toEqual({
      kind: "entry_size_mismatch",
      part: "a.xml",
    });
  });

  it("refuses a deflate stream shorter than its declared size", () => {
    const zip = directory(buildZip([{ name: "a.xml", data: "abc", declaredSize: 10 }]));
    expect(errorOf(readZipEntry(zip, entryOf(zip, "a.xml"), PART))).toEqual({
      kind: "entry_size_mismatch",
      part: "a.xml",
    });
  });

  it("refuses data that is not a deflate stream", () => {
    const bytes = tamper(ONE, ({ view }) => {
      view.setUint8(35, 0xff);
      view.setUint8(36, 0xff);
    });
    const zip = directory(bytes);
    expect(errorOf(readZipEntry(zip, entryOf(zip, "a.xml"), PART))).toMatchObject({
      kind: "archive_corrupt",
    });
  });

  it("refuses a wrong CRC-32", () => {
    const zip = directory(buildZip([{ name: "a.xml", data: "abc", declaredCrc: 1 }]));
    expect(errorOf(readZipEntry(zip, entryOf(zip, "a.xml"), PART))).toEqual({
      kind: "archive_corrupt",
      reason: "checksum",
      part: "a.xml",
    });
  });
});

describe("readZipEntry caps", () => {
  it("refuses a part that declares more than the cap, before inflating it", () => {
    const zip = directory(buildZip([{ name: "a.xml", data: new Uint8Array(PART + 1) }]));
    expect(errorOf(readZipEntry(zip, entryOf(zip, "a.xml"), PART))).toEqual({
      kind: "part_too_large",
      part: "a.xml",
      size: PART + 1,
      limit: PART,
    });
  });

  it("reads a part of exactly the cap", () => {
    const zip = directory(buildZip([{ name: "a.xml", data: new Uint8Array(PART) }]));
    const read = readZipEntry(zip, entryOf(zip, "a.xml"), PART);
    expect(read.ok && read.value.length).toBe(PART);
  });

  it("reads a deflated entry that declares size 0 and holds an empty stream", () => {
    const zip = directory(buildZip([{ name: "a.xml", data: "" }]));
    const read = readZipEntry(zip, entryOf(zip, "a.xml"), PART);
    expect(read.ok && read.value.length).toBe(0);
  });

  it("refuses a deflated entry that declares size 0 but holds data", () => {
    const zip = directory(buildZip([{ name: "a.xml", data: "xy", declaredSize: 0 }]));
    expect(errorOf(readZipEntry(zip, entryOf(zip, "a.xml"), PART))).toEqual({
      kind: "entry_size_mismatch",
      part: "a.xml",
    });
  });

  it("names a part with a long name cut to 128 characters", () => {
    const name = `${"n".repeat(1_000)}.xml`;
    const zip = directory(buildZip([{ name, data: "abc", declaredCrc: 1 }]));
    const error = errorOf(readZipEntry(zip, entryOf(zip, name), PART));
    expect(error).toEqual({ kind: "archive_corrupt", reason: "checksum", part: "n".repeat(128) });
  });
});

describe("the end record (APPNOTE §4.3.16)", () => {
  it("reads an archive whose comment is exactly 65,535 bytes", () => {
    const zip = directory(buildZip(ONE, { comment: new Uint8Array(0xffff) }));
    expect([...zip.entries.keys()]).toEqual(["a.xml"]);
  });

  it("refuses a comment that ends with a second end record, because the last record is read and no directory ends at it", () => {
    const plain = buildZip(ONE);
    const bytes = buildZip(ONE, { comment: plain.subarray(-22) });
    expect(errorOf(readZipDirectory(bytes, LIMITS))).toEqual({
      kind: "archive_corrupt",
      reason: "central_directory",
    });
  });
});

describe("local headers against the central directory", () => {
  const TWO: ZipPart[] = [...ONE, { name: "b.xml", data: "<b/>" }];

  function centralOffsetOf(view: DataView, end: number, index: number): number {
    let offset = view.getUint32(end + 16, true);
    for (let at = 0; at < index; at += 1) {
      offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true);
    }
    return offset;
  }

  it("refuses two entries that share one local header", () => {
    const bytes = tamper(TWO, ({ view, end }) =>
      view.setUint32(centralOffsetOf(view, end, 1) + 42, 0, true),
    );
    expect(errorOf(readZipDirectory(bytes, LIMITS))).toEqual({
      kind: "archive_corrupt",
      reason: "entry_overlap",
    });
  });

  it("refuses an entry whose local header lies inside another entry's data", () => {
    const bytes = tamper(TWO, ({ view, end }) =>
      view.setUint32(centralOffsetOf(view, end, 1) + 42, 31, true),
    );
    expect(errorOf(readZipDirectory(bytes, LIMITS))).toEqual({
      kind: "archive_corrupt",
      reason: "entry_overlap",
    });
  });

  it("refuses data that would run into the central directory through a large local extra field", () => {
    const bytes = tamper(ONE, ({ view }) => view.setUint16(28, 60_000, true));
    expect(errorOf(readZipDirectory(bytes, LIMITS))).toEqual({
      kind: "archive_corrupt",
      reason: "local_header",
    });
  });

  it.each([
    ["the CRC-32", 14],
    ["the compressed size", 18],
    ["the unpacked size", 22],
  ])("refuses a local header whose %s disagrees, without a data descriptor", (_, field) => {
    const bytes = tamper(ONE, ({ view }) => view.setUint32(field, 1234, true));
    expect(errorOf(readZipDirectory(bytes, LIMITS))).toMatchObject({ reason: "local_header" });
  });

  it("reads a local header with zero sizes and CRC when the data descriptor flag is set", () => {
    const parts: ZipPart[] = [{ name: "a.xml", data: "<a/>", flags: 0x0008 }];
    const bytes = tamper(parts, ({ view }) => {
      view.setUint32(14, 0, true);
      view.setUint32(18, 0, true);
      view.setUint32(22, 0, true);
    });
    const zip = directory(bytes);
    const read = readZipEntry(zip, entryOf(zip, "a.xml"), PART);
    expect(read.ok && new TextDecoder().decode(read.value)).toBe("<a/>");
  });

  it("reads a local header whose flags differ only in the deflate speed bits 1 and 2", () => {
    const zip = directory(tamper(ONE, ({ view }) => view.setUint16(6, 0x0006, true)));
    const read = readZipEntry(zip, entryOf(zip, "a.xml"), PART);
    expect(read.ok && new TextDecoder().decode(read.value)).toBe("<a>invented</a>");
  });

  it.each([
    ["the data descriptor bit", 0x0008],
    ["the UTF-8 name bit", 0x0800],
  ])("refuses a local header whose flags differ in %s", (_, bit) => {
    const bytes = tamper(ONE, ({ view }) => view.setUint16(6, bit, true));
    expect(errorOf(readZipDirectory(bytes, LIMITS))).toMatchObject({ reason: "local_header" });
  });

  it("refuses a local header whose method differs from the directory", () => {
    const bytes = tamper(ONE, ({ view }) => view.setUint16(8, 0, true));
    expect(errorOf(readZipDirectory(bytes, LIMITS))).toMatchObject({ reason: "local_header" });
  });

  it("refuses a local header whose name differs from the directory", () => {
    const bytes = tamper(ONE, ({ view }) => view.setUint8(30, "b".charCodeAt(0)));
    expect(errorOf(readZipDirectory(bytes, LIMITS))).toMatchObject({ reason: "local_header" });
  });

  it("refuses a local header with a wrong signature", () => {
    const bytes = tamper(ONE, ({ view }) => view.setUint32(0, 0, true));
    expect(errorOf(readZipDirectory(bytes, LIMITS))).toMatchObject({ reason: "local_header" });
  });

  it("names no entry in a directory error, however long its name", () => {
    const bytes = buildZip([{ name: "n".repeat(65_000), data: "<a/>", method: 12 }]);
    expect(errorOf(readZipDirectory(bytes, LIMITS))).toEqual({
      kind: "archive_unsupported",
      reason: "compression_method",
    });
  });
});
