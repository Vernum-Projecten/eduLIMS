// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Invented test images for the logo check (#292), built byte by byte so no binary fixture and no
// real photo enters the repository: a PNG with any chunks, a baseline JPEG with any segments, and
// the metadata a camera writes (EXIF with a GPS position, XMP, IPTC, an ICC profile, comments).
// The position is invented. Every image here decodes in a browser.
import { crc32, deflateSync } from "node:zlib";
import { concat } from "./png.ts";

const encoder = new TextEncoder();

/** Returns the bytes of `text` as ASCII or UTF-8. */
export function ascii(text: string): Uint8Array {
  return encoder.encode(text);
}

/** Returns whether `needle` occurs in `haystack`. */
export function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

function u32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
}

function u16(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value);
  return out;
}

/** Returns one PNG chunk with its length and CRC. */
export function pngChunk(type: string, data: Uint8Array = new Uint8Array()): Uint8Array {
  const body = concat([ascii(type), data]);
  return concat([u32(data.length), body, u32(crc32(body))]);
}

/** Returns an IHDR chunk. */
export function ihdr(
  width: number,
  height: number,
  options: { bitDepth?: number; colourType?: number; interlace?: number } = {},
): Uint8Array {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  view.setUint8(8, options.bitDepth ?? 8);
  view.setUint8(9, options.colourType ?? 6);
  view.setUint8(12, options.interlace ?? 0);
  return pngChunk("IHDR", data);
}

/** Returns the IDAT chunk of a fully transparent RGBA image of `width` by `height`. */
export function idat(width: number, height: number): Uint8Array {
  const raw = new Uint8Array(height * (1 + width * 4));
  return pngChunk("IDAT", deflateSync(raw));
}

/** The PNG signature. */
export const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

/** Returns a PNG of the signature and `chunks` as given. */
export function pngOf(chunks: readonly Uint8Array[]): Uint8Array {
  return concat([SIGNATURE, ...chunks]);
}

/**
 * Returns a valid RGBA PNG of `width` by `height`; `before` goes between IHDR and IDAT, `after`
 * between IDAT and IEND, `trailing` after IEND.
 */
export function png(
  width = 4,
  height = 4,
  options: { before?: Uint8Array[]; after?: Uint8Array[]; trailing?: Uint8Array } = {},
): Uint8Array {
  return concat([
    pngOf([
      ihdr(width, height),
      ...(options.before ?? []),
      idat(width, height),
      ...(options.after ?? []),
      pngChunk("IEND"),
    ]),
    options.trailing ?? new Uint8Array(),
  ]);
}

/**
 * A little-endian TIFF block as EXIF carries it, with a GPS IFD that holds an invented latitude
 * (12° 34' 56" N): IFD0 points at the GPS IFD, which holds the reference and the three rationals.
 */
export function exifWithPosition(): Uint8Array {
  const out = new Uint8Array(8 + 18 + 30 + 24);
  const view = new DataView(out.buffer);
  out.set(ascii("II*\0"));
  view.setUint32(4, 8, true);
  // IFD0 at 8: one entry, GPSInfo (0x8825, LONG) pointing at the GPS IFD at 26.
  view.setUint16(8, 1, true);
  view.setUint16(10, 0x8825, true);
  view.setUint16(12, 4, true);
  view.setUint32(14, 1, true);
  view.setUint32(18, 26, true);
  view.setUint32(22, 0, true);
  // GPS IFD at 26: GPSLatitudeRef "N" and GPSLatitude, three RATIONALs at 56.
  view.setUint16(26, 2, true);
  view.setUint16(28, 0x0001, true);
  view.setUint16(30, 2, true);
  view.setUint32(32, 2, true);
  out.set(ascii("N\0"), 36);
  view.setUint16(40, 0x0002, true);
  view.setUint16(42, 5, true);
  view.setUint32(44, 3, true);
  view.setUint32(48, 56, true);
  view.setUint32(52, 0, true);
  for (const [index, value] of [12, 34, 56].entries()) {
    view.setUint32(56 + index * 8, value, true);
    view.setUint32(60 + index * 8, 1, true);
  }
  return out;
}

/** An XMP packet with an invented position, as photo tools write it. */
export const XMP_WITH_POSITION = ascii(
  '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    '<rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="12,34.9N"/>' +
    "</rdf:RDF></x:xmpmeta>",
);

/** The PNG metadata chunks a tool may write: text, compressed text, international text, time, EXIF. */
export function pngMetadataChunks(): Uint8Array[] {
  return [
    pngChunk("tEXt", ascii("Comment\0Made at the invented field site")),
    pngChunk("zTXt", concat([ascii("Author\0\0"), deflateSync(ascii("Invented Author"))])),
    pngChunk("iTXt", concat([ascii("XML:com.adobe.xmp\0\0\0\0\0"), XMP_WITH_POSITION])),
    pngChunk("tIME", Uint8Array.of(0x07, 0xea, 11, 19, 9, 0, 0)),
    pngChunk("eXIf", exifWithPosition()),
    pngChunk("pHYs", Uint8Array.of(0, 0, 0x0b, 0x13, 0, 0, 0x0b, 0x13, 1)),
    pngChunk("iCCP", concat([ascii("Invented profile\0\0"), deflateSync(ascii("profile"))])),
  ];
}

/** Returns a JPEG marker segment with its length. */
export function jpegSegment(marker: number, payload: Uint8Array = new Uint8Array()): Uint8Array {
  return concat([Uint8Array.of(0xff, marker), u16(payload.length + 2), payload]);
}

/** The APP1 EXIF segment with a GPS position. */
export function jpegExif(): Uint8Array {
  return jpegSegment(0xe1, concat([ascii("Exif\0\0"), exifWithPosition()]));
}

/** The JPEG metadata segments a camera or editor writes: JFIF, EXIF, XMP, ICC, IPTC, a comment. */
export function jpegMetadataSegments(): Uint8Array[] {
  return [
    jpegSegment(0xe0, concat([ascii("JFIF\0"), Uint8Array.of(1, 2, 0, 0, 1, 0, 1, 0, 0)])),
    jpegExif(),
    jpegSegment(0xe1, concat([ascii("http://ns.adobe.com/xap/1.0/\0"), XMP_WITH_POSITION])),
    jpegSegment(0xe2, concat([ascii("ICC_PROFILE\0"), Uint8Array.of(1, 1), ascii("profile")])),
    jpegSegment(0xed, concat([ascii("Photoshop 3.0\0"), ascii("8BIM invented caption")])),
    jpegSegment(0xfe, ascii("Shot at the invented field site")),
  ];
}

/** The Adobe APP14 segment (transform 1, YCbCr) a decoder reads. */
export function jpegAdobe(): Uint8Array {
  return jpegSegment(0xee, concat([ascii("Adobe"), Uint8Array.of(0, 100, 0, 0, 0, 0, 1)]));
}

/**
 * Returns a valid grey baseline JPEG of `width` by `height`. Every 8 by 8 block is flat: one DC
 * table and one AC table each hold the single code `0` (category 0 and end of block), so each
 * block is the bits `00`. With `restart`, every block ends its own interval with an RSTn.
 */
export function jpeg(
  width = 8,
  height = 8,
  options: {
    before?: Uint8Array[];
    trailing?: Uint8Array;
    frameMarker?: number;
    precision?: number;
    restart?: boolean;
  } = {},
): Uint8Array {
  const blocks = Math.ceil(width / 8) * Math.ceil(height / 8);
  const quant = jpegSegment(0xdb, concat([Uint8Array.of(0), new Uint8Array(64).fill(1)]));
  const frame = jpegSegment(
    options.frameMarker ?? 0xc0,
    concat([
      Uint8Array.of(options.precision ?? 8),
      u16(height),
      u16(width),
      Uint8Array.of(1, 1, 0x11, 0),
    ]),
  );
  const huffman = (tableClass: number) =>
    jpegSegment(
      0xc4,
      concat([
        Uint8Array.of(tableClass << 4),
        Uint8Array.of(1),
        new Uint8Array(15),
        Uint8Array.of(0),
      ]),
    );
  const scan = jpegSegment(0xda, Uint8Array.of(1, 1, 0x00, 0, 63, 0));
  let entropy: Uint8Array;
  let restartInterval: Uint8Array[] = [];
  if (options.restart) {
    restartInterval = [jpegSegment(0xdd, u16(1))];
    const parts: Uint8Array[] = [];
    for (let block = 0; block < blocks; block += 1) {
      parts.push(Uint8Array.of(0x3f));
      if (block < blocks - 1) parts.push(Uint8Array.of(0xff, 0xd0 + (block % 8)));
    }
    entropy = concat(parts);
  } else {
    const bits = blocks * 2;
    entropy = new Uint8Array(Math.ceil(bits / 8));
    const tail = bits % 8;
    if (tail !== 0) entropy[entropy.length - 1] = (1 << (8 - tail)) - 1;
  }
  return concat([
    Uint8Array.of(0xff, 0xd8),
    ...(options.before ?? []),
    quant,
    frame,
    huffman(0),
    huffman(1),
    ...restartInterval,
    scan,
    entropy,
    Uint8Array.of(0xff, 0xd9),
    options.trailing ?? new Uint8Array(),
  ]);
}
