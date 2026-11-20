// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The PNG side of the logo check (#292, ASVS 5.0 V5.2.2): reads the chunk layout of the W3C PNG
// specification (Third Edition, §5.3 chunk layout, §5.6 chunk ordering, §11.2.1 IHDR), checks
// every CRC and the image header, and writes the file again with only the chunks a browser needs
// to render it. Text, time, EXIF and every other ancillary chunk are dropped (metadata, #292);
// the image data is copied as it came, never decoded or re-encoded. Bytes after IEND are dropped.
import "@tanstack/react-start/server-only";
import { crc32 } from "node:zlib";
import { LOGO_MAX_SIDE } from "../../lib/lab-logo.ts";
import { fault, type ImageCheck, malformed } from "./types.ts";

/** The eight bytes every PNG starts with (§5.2). */
export const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

/**
 * The chunks kept: the critical ones, and the ancillary ones that change how the pixels look
 * (transparency and colour space). `iCCP` is dropped: an embedded profile is free-form data.
 */
export const PNG_KEPT_CHUNKS: ReadonlySet<string> = new Set([
  "IHDR",
  "PLTE",
  "IDAT",
  "IEND",
  "tRNS",
  "gAMA",
  "cHRM",
  "sRGB",
  "cICP",
]);

/** The fixed length of each kept colour chunk (§11.3.2), so none of them carries other data. */
const COLOUR_CHUNK_LENGTHS: ReadonlyMap<string, number> = new Map([
  ["gAMA", 4],
  ["cHRM", 32],
  ["sRGB", 1],
  ["cICP", 4],
]);

/**
 * Returns whether a kept ancillary chunk has the length its type allows: the colour chunks their
 * fixed length, `tRNS` the length of one grey or RGB sample or at most one byte per palette entry
 * (§11.3.1.1).
 */
function fitsLength(type: string, length: number, colourType: number, paletteSize: number) {
  const fixed = COLOUR_CHUNK_LENGTHS.get(type);
  if (fixed !== undefined) return length === fixed;
  if (type !== "tRNS") return false;
  if (colourType === 0) return length === 2;
  if (colourType === 2) return length === 6;
  return colourType === 3 && length >= 1 && length <= paletteSize;
}

/** The bit depths each colour type allows (§11.2.1, Table 11). */
const BIT_DEPTHS: ReadonlyMap<number, readonly number[]> = new Map([
  [0, [1, 2, 4, 8, 16]],
  [2, [8, 16]],
  [3, [1, 2, 4, 8]],
  [4, [8, 16]],
  [6, [8, 16]],
]);

/** The largest chunk length the specification allows (§5.3: 2^31 - 1). */
const MAX_CHUNK_LENGTH = 0x7fff_ffff;

/** Returns whether `bytes` starts with the PNG signature. */
export function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

function isLetter(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

interface Header {
  width: number;
  height: number;
  colourType: number;
}

/** Reads the 13 bytes of IHDR, or `null` when a field breaks §11.2.1. */
function readHeader(view: DataView, start: number): Header | null {
  const width = view.getUint32(start);
  const height = view.getUint32(start + 4);
  const bitDepth = view.getUint8(start + 8);
  const colourType = view.getUint8(start + 9);
  const compression = view.getUint8(start + 10);
  const filter = view.getUint8(start + 11);
  const interlace = view.getUint8(start + 12);
  const depths = BIT_DEPTHS.get(colourType);
  if (width === 0 || height === 0 || width > MAX_CHUNK_LENGTH || height > MAX_CHUNK_LENGTH) {
    return null;
  }
  if (!depths?.includes(bitDepth) || compression !== 0 || filter !== 0 || interlace > 1) {
    return null;
  }
  return { width, height, colourType };
}

/**
 * Checks a PNG and returns it with only {@link PNG_KEPT_CHUNKS}, or the reason it is refused.
 * The caller has checked the signature and the file size.
 */
export function filterPng(bytes: Uint8Array): ImageCheck {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kept: Uint8Array[] = [PNG_SIGNATURE];
  let header: Header | null = null;
  let paletteSize = 0;
  const ancillary = new Set<string>();
  let dataSeen = false;
  let dataEnded = false;
  let position = PNG_SIGNATURE.length;
  for (;;) {
    if (position + 12 > bytes.length) return malformed(header ? "png_no_iend" : "truncated");
    const length = view.getUint32(position);
    if (length > MAX_CHUNK_LENGTH) return malformed("png_chunk_length");
    const end = position + 12 + length;
    if (end > bytes.length) return malformed("truncated");
    const typeBytes = bytes.subarray(position + 4, position + 8);
    if (!typeBytes.every(isLetter)) return malformed("png_chunk_type");
    if (crc32(bytes.subarray(position + 4, end - 4)) !== view.getUint32(end - 4)) {
      return malformed("png_crc");
    }
    const type = String.fromCharCode(...typeBytes);
    const chunk = bytes.subarray(position, end);
    position = end;
    if (header === null) {
      if (type !== "IHDR" || length !== 13) return malformed("png_ihdr");
      header = readHeader(view, end - 4 - 13);
      if (header === null) return malformed("png_ihdr");
      if (header.width > LOGO_MAX_SIDE || header.height > LOGO_MAX_SIDE) {
        return fault({
          kind: "logo_too_many_pixels",
          width: header.width,
          height: header.height,
        });
      }
      kept.push(chunk);
      continue;
    }
    if (dataSeen && type !== "IDAT") dataEnded = true;
    switch (type) {
      case "IHDR":
        return malformed("png_order");
      case "PLTE":
        if (paletteSize > 0 || dataSeen) return malformed("png_order");
        if (header.colourType === 0 || header.colourType === 4) return malformed("png_plte");
        if (length === 0 || length > 768 || length % 3 !== 0) return malformed("png_plte");
        paletteSize = length / 3;
        kept.push(chunk);
        break;
      case "IDAT":
        if (dataEnded) return malformed("png_order");
        if (header.colourType === 3 && paletteSize === 0) return malformed("png_plte");
        dataSeen = true;
        kept.push(chunk);
        break;
      case "IEND":
        if (!dataSeen) return malformed("png_no_idat");
        if (length !== 0) return malformed("png_chunk_length");
        kept.push(chunk);
        return {
          ok: true,
          image: {
            mediaType: "image/png",
            width: header.width,
            height: header.height,
            bytes: concat(kept),
          },
        };
      default: {
        // §5.4: bit 5 of the first byte clear marks a critical chunk a decoder must understand.
        const critical = (typeBytes[0] ?? 0) < 0x61;
        if (critical) return malformed("png_critical_chunk");
        // A kept chunk counts once, before the image data, at the length its type allows.
        if (
          PNG_KEPT_CHUNKS.has(type) &&
          !dataSeen &&
          !ancillary.has(type) &&
          fitsLength(type, length, header.colourType, paletteSize)
        ) {
          ancillary.add(type);
          kept.push(chunk);
        }
      }
    }
  }
}

/** Joins `parts` into one array. */
export function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
