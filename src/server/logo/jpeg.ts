// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The JPEG side of the logo check (#292, ASVS 5.0 V5.2.2): reads the marker segments of ITU-T
// T.81 (ISO/IEC 10918-1) Annex B, checks the frame header (B.2.2), and writes the file again with
// only the segments a decoder needs: the frame, the tables, the restart interval and the scans
// with their entropy-coded data, copied as they came. Every APPn segment (JFIF, EXIF, XMP, ICC,
// IPTC) and every comment is dropped, except the fixed-size Adobe APP14 segment that tells a
// decoder the colour transform. Bytes after the first EOI are dropped.
import "@tanstack/react-start/server-only";
import { LOGO_MAX_SIDE } from "../../lib/lab-logo.ts";
import { concat } from "./png.ts";
import { fault, type ImageCheck, malformed } from "./types.ts";

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const DQT = 0xdb;
const DRI = 0xdd;
const DHT = 0xc4;
const APP14 = 0xee;
/** The frame types a browser decodes: baseline, extended sequential and progressive Huffman. */
const SUPPORTED_FRAMES: ReadonlySet<number> = new Set([0xc0, 0xc1, 0xc2]);
/** Every other start-of-frame marker (B.1.1.3): lossless, hierarchical, arithmetic. */
const OTHER_FRAMES: ReadonlySet<number> = new Set([
  0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);
/** The tables and the restart interval a decoder reads (B.2.4). */
const TABLES: ReadonlySet<number> = new Set([DQT, DHT, DRI]);
/** "Adobe" and the 7 fixed bytes after it (Adobe Technical Note 5116, the APP14 segment). */
const ADOBE = [0x41, 0x64, 0x6f, 0x62, 0x65];
const ADOBE_PAYLOAD = 12;

/** Returns whether `bytes` starts with SOI and a marker, as every JPEG does. */
export function isJpeg(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === SOI && bytes[2] === 0xff;
}

function isRestart(marker: number): boolean {
  return marker >= 0xd0 && marker <= 0xd7;
}

/** Returns the end of the entropy-coded data that starts at `start` (B.1.1.5), or -1. */
function entropyEnd(bytes: Uint8Array, start: number): number {
  let index = start;
  while (index + 1 < bytes.length) {
    if (bytes[index] === 0xff) {
      const next = bytes[index + 1] ?? 0;
      if (next === 0x00 || isRestart(next)) {
        index += 2;
        continue;
      }
      return index;
    }
    index += 1;
  }
  return -1;
}

/** Returns a marker segment written again: the marker without fill bytes, then its payload. */
function segment(marker: number, payload: Uint8Array): Uint8Array {
  return concat([Uint8Array.of(0xff, marker), payload]);
}

/**
 * Checks a JPEG and returns it without its metadata segments, or the reason it is refused. The
 * caller has checked the signature and the file size.
 */
export function filterJpeg(bytes: Uint8Array): ImageCheck {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kept: Uint8Array[] = [Uint8Array.of(0xff, SOI)];
  let frame: { width: number; height: number } | null = null;
  let scanned = false;
  let position = 2;
  for (;;) {
    if (position >= bytes.length) return malformed(scanned ? "jpeg_no_eoi" : "truncated");
    if (bytes[position] !== 0xff) return malformed("jpeg_marker");
    // B.1.1.2: any number of 0xFF fill bytes may come before a marker.
    while (bytes[position] === 0xff) position += 1;
    if (position >= bytes.length) return malformed("truncated");
    const marker = bytes[position] ?? 0;
    position += 1;
    if (marker === EOI) {
      if (!scanned) return malformed("jpeg_no_scan");
      if (frame === null) return malformed("jpeg_no_frame");
      kept.push(Uint8Array.of(0xff, EOI));
      return {
        ok: true,
        image: {
          mediaType: "image/jpeg",
          width: frame.width,
          height: frame.height,
          bytes: concat(kept),
        },
      };
    }
    if (marker === 0x00 || marker === 0x01 || marker === SOI || isRestart(marker)) {
      return malformed("jpeg_marker");
    }
    if (position + 2 > bytes.length) return malformed("truncated");
    const length = view.getUint16(position);
    if (length < 2) return malformed("jpeg_segment_length");
    const end = position + length;
    if (end > bytes.length) return malformed("truncated");
    const payload = bytes.subarray(position, end);
    position = end;
    if (OTHER_FRAMES.has(marker))
      return fault({ kind: "logo_unsupported_type", detail: "jpeg_process" });
    if (SUPPORTED_FRAMES.has(marker)) {
      if (frame !== null) return malformed("jpeg_frame");
      const read = readFrame(payload);
      if (read === "unsupported")
        return fault({ kind: "logo_unsupported_type", detail: "jpeg_process" });
      if (read === null) return malformed("jpeg_frame");
      if (read.width > LOGO_MAX_SIDE || read.height > LOGO_MAX_SIDE) {
        return fault({ kind: "logo_too_many_pixels", width: read.width, height: read.height });
      }
      frame = read;
      kept.push(segment(marker, payload));
    } else if (TABLES.has(marker)) {
      kept.push(segment(marker, payload));
    } else if (marker === SOS) {
      if (frame === null) return malformed("jpeg_no_frame");
      // B.2.3: Ls = 6 + 2 * Ns, with 1 to 4 components in a scan.
      const components = payload[2] ?? 0;
      if (components < 1 || components > 4 || length !== 6 + 2 * components) {
        return malformed("jpeg_scan");
      }
      const dataEnd = entropyEnd(bytes, position);
      if (dataEnd < 0) return malformed("jpeg_no_eoi");
      kept.push(segment(marker, payload), bytes.subarray(position, dataEnd));
      position = dataEnd;
      scanned = true;
    } else if (marker === APP14 && isAdobe(payload)) {
      kept.push(segment(marker, payload));
    } else if (marker < 0xc0) {
      // B.1.1.3: 0x02 to 0xBF are reserved markers.
      return malformed("jpeg_marker");
    }
    // Every other segment (APPn, COM, DAC, DNL, DHP, EXP, JPGn) is dropped.
  }
}

/** Returns whether an APP14 payload is the fixed Adobe segment and nothing more. */
function isAdobe(payload: Uint8Array): boolean {
  return (
    payload.length === 2 + ADOBE_PAYLOAD &&
    ADOBE.every((value, index) => payload[2 + index] === value)
  );
}

/**
 * Reads a frame header (B.2.2): 8-bit samples, a height and width above zero, and 1, 3 or 4
 * components. A 12-bit frame is `"unsupported"`; a broken header is `null`.
 */
function readFrame(payload: Uint8Array): { width: number; height: number } | "unsupported" | null {
  if (payload.length < 8) return null;
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const precision = view.getUint8(2);
  const height = view.getUint16(3);
  const width = view.getUint16(5);
  const components = view.getUint8(7);
  if (payload.length !== 8 + 3 * components) return null;
  if (precision !== 8) return precision === 12 ? "unsupported" : null;
  if (height === 0 || width === 0) return null;
  if (components !== 1 && components !== 3 && components !== 4) return null;
  return { width, height };
}
