// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// A PNG or a JPEG whose structure is broken is refused with `logo_malformed` and the place it
// broke (#292; ASVS 5.0 V5.2.2): a CRC, the image header, the chunk order, a marker, a segment.
import { describe, expect, it } from "vitest";
import { checkLogo } from "./image.ts";
import { concat } from "./png.ts";
import { ascii, idat, ihdr, jpeg, jpegSegment, png, pngChunk, pngOf } from "./test-images.ts";

const concatBytes = (...parts: Uint8Array[]) => concat(parts);

describe("checkLogo: a broken PNG is refused (#292)", () => {
  const good = png(2, 2);

  function withByte(bytes: Uint8Array, at: number, value: number): Uint8Array {
    const out = bytes.slice();
    out[at] = value;
    return out;
  }

  it.each<[string, Uint8Array, string]>([
    ["a wrong CRC", withByte(good, 8 + 8 + 13, (good[8 + 8 + 13] ?? 0) ^ 1), "png_crc"],
    ["a first chunk other than IHDR", pngOf([idat(1, 1), pngChunk("IEND")]), "png_ihdr"],
    ["an IHDR of the wrong length", pngOf([pngChunk("IHDR", new Uint8Array(12))]), "png_ihdr"],
    ["a width of zero", pngOf([ihdr(0, 1), pngChunk("IEND")]), "png_ihdr"],
    [
      "a bit depth the colour type forbids",
      pngOf([ihdr(1, 1, { bitDepth: 4, colourType: 6 })]),
      "png_ihdr",
    ],
    ["an unknown colour type", pngOf([ihdr(1, 1, { colourType: 5 })]), "png_ihdr"],
    ["an unknown interlace method", pngOf([ihdr(1, 1, { interlace: 2 })]), "png_ihdr"],
    ["a second IHDR", pngOf([ihdr(1, 1), ihdr(1, 1)]), "png_order"],
    ["no image data", pngOf([ihdr(1, 1), pngChunk("IEND")]), "png_no_idat"],
    ["no IEND", pngOf([ihdr(1, 1), idat(1, 1)]), "png_no_iend"],
    [
      "an IEND with data",
      pngOf([ihdr(1, 1), idat(1, 1), pngChunk("IEND", Uint8Array.of(0))]),
      "png_chunk_length",
    ],
    [
      "image data split by another chunk",
      pngOf([
        ihdr(1, 1),
        idat(1, 1),
        pngChunk("tEXt", ascii("a\0b")),
        idat(1, 1),
        pngChunk("IEND"),
      ]),
      "png_order",
    ],
    [
      "an unknown critical chunk",
      pngOf([ihdr(1, 1), pngChunk("ABCD"), idat(1, 1), pngChunk("IEND")]),
      "png_critical_chunk",
    ],
    [
      "a chunk type that is not letters",
      pngOf([ihdr(1, 1), pngChunk("a1cd"), idat(1, 1), pngChunk("IEND")]),
      "png_chunk_type",
    ],
    [
      "a palette in a grey image",
      pngOf([ihdr(1, 1, { colourType: 0 }), pngChunk("PLTE", Uint8Array.of(1, 2, 3))]),
      "png_plte",
    ],
    [
      "a palette image without a palette",
      pngOf([ihdr(1, 1, { colourType: 3 }), idat(1, 1), pngChunk("IEND")]),
      "png_plte",
    ],
    [
      "a palette of a length not a multiple of 3",
      pngOf([ihdr(1, 1, { colourType: 3 }), pngChunk("PLTE", Uint8Array.of(1, 2))]),
      "png_plte",
    ],
    [
      "a palette after the image data",
      pngOf([ihdr(1, 1, { colourType: 2 }), idat(1, 1), pngChunk("PLTE", Uint8Array.of(1, 2, 3))]),
      "png_order",
    ],
    ["a chunk longer than the file", good.subarray(0, good.length - 20), "truncated"],
    ["only the signature", good.subarray(0, 8), "truncated"],
  ])("refuses %s", (_name, bytes, at) => {
    expect(checkLogo(bytes)).toEqual({ ok: false, fault: { kind: "logo_malformed", at } });
  });

  it("refuses a chunk length over 2^31 - 1", () => {
    const bytes = pngOf([
      ihdr(1, 1),
      Uint8Array.of(0x80, 0, 0, 0),
      ascii("tEXt"),
      new Uint8Array(4),
    ]);
    expect(checkLogo(bytes)).toEqual({
      ok: false,
      fault: { kind: "logo_malformed", at: "png_chunk_length" },
    });
  });
});

describe("checkLogo: a broken JPEG is refused (#292)", () => {
  const good = jpeg(8, 8);
  const sof = (payload: number[]) => jpegSegment(0xc0, Uint8Array.from(payload));

  it.each<[string, Uint8Array, string]>([
    ["no EOI", good.subarray(0, good.length - 2), "jpeg_no_eoi"],
    ["a cut after the start marker", Uint8Array.of(0xff, 0xd8, 0xff), "truncated"],
    [
      "a segment longer than the file",
      Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0x10, 0x00, 0x00),
      "truncated",
    ],
    [
      "a segment length below 2",
      Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01),
      "jpeg_segment_length",
    ],
    [
      "a byte where a marker belongs",
      Uint8Array.of(0xff, 0xd8, 0xff, 0xfe, 0x00, 0x02, 0x41),
      "jpeg_marker",
    ],
    ["a second SOI", Uint8Array.of(0xff, 0xd8, 0xff, 0xd8), "jpeg_marker"],
    ["a restart marker outside a scan", Uint8Array.of(0xff, 0xd8, 0xff, 0xd0), "jpeg_marker"],
    ["a reserved marker", Uint8Array.of(0xff, 0xd8, 0xff, 0x02, 0x00, 0x02), "jpeg_marker"],
    ["EOI before any scan", Uint8Array.of(0xff, 0xd8, 0xff, 0xd9), "jpeg_no_scan"],
    [
      "a scan before the frame",
      concatBytes(Uint8Array.of(0xff, 0xd8), jpegSegment(0xda, Uint8Array.of(1, 1, 0, 0, 63, 0))),
      "jpeg_no_frame",
    ],
    [
      "a frame of height zero",
      concatBytes(Uint8Array.of(0xff, 0xd8), sof([8, 0, 0, 0, 8, 1, 1, 0x11, 0])),
      "jpeg_frame",
    ],
    [
      "a frame of two components",
      concatBytes(Uint8Array.of(0xff, 0xd8), sof([8, 0, 8, 0, 8, 2, 1, 0x11, 0, 2, 0x11, 0])),
      "jpeg_frame",
    ],
    [
      "a frame header of the wrong length",
      concatBytes(Uint8Array.of(0xff, 0xd8), sof([8, 0, 8, 0, 8, 1, 1, 0x11])),
      "jpeg_frame",
    ],
    [
      "a frame of 7-bit samples",
      concatBytes(Uint8Array.of(0xff, 0xd8), sof([7, 0, 8, 0, 8, 1, 1, 0x11, 0])),
      "jpeg_frame",
    ],
    [
      "a second frame",
      concatBytes(
        Uint8Array.of(0xff, 0xd8),
        sof([8, 0, 8, 0, 8, 1, 1, 0x11, 0]),
        sof([8, 0, 8, 0, 8, 1, 1, 0x11, 0]),
      ),
      "jpeg_frame",
    ],
    [
      "a scan header of the wrong length",
      concatBytes(
        Uint8Array.of(0xff, 0xd8),
        sof([8, 0, 8, 0, 8, 1, 1, 0x11, 0]),
        jpegSegment(0xda, Uint8Array.of(2, 1, 0, 0, 63, 0)),
      ),
      "jpeg_scan",
    ],
  ])("refuses %s", (_name, bytes, at) => {
    expect(checkLogo(bytes)).toEqual({ ok: false, fault: { kind: "logo_malformed", at } });
  });
});
