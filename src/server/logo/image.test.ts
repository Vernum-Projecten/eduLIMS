// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The content check and metadata filter of the lab logo (#292; ASVS 5.0 V5.2.1, V5.2.2): the
// type comes from the bytes, the limits hold at and one over, every metadata chunk and segment
// is gone from the stored bytes, and the image data is copied as it came.
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { LOGO_MAX_BYTES, LOGO_MAX_SIDE } from "../../lib/lab-logo.ts";
import { checkLogo } from "./image.ts";
import { PNG_KEPT_CHUNKS } from "./png.ts";
import {
  ascii,
  contains,
  exifWithPosition,
  idat,
  ihdr,
  jpeg,
  jpegAdobe,
  jpegExif,
  jpegMetadataSegments,
  jpegSegment,
  png,
  pngChunk,
  pngMetadataChunks,
  pngOf,
  XMP_WITH_POSITION,
} from "./test-images.ts";
import type { FilteredImage, ImageCheck } from "./types.ts";

function accepted(result: ImageCheck): FilteredImage {
  if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.fault)}`);
  return result.image;
}

/** Returns the chunk types of a PNG, in order. */
function chunkTypes(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const types: string[] = [];
  for (let at = 8; at + 12 <= bytes.length; ) {
    const length = view.getUint32(at);
    types.push(String.fromCharCode(...bytes.subarray(at + 4, at + 8)));
    at += 12 + length;
  }
  return types;
}

/** Returns the markers of a JPEG outside its entropy-coded data, in order. */
function markers(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const found: number[] = [];
  let at = 2;
  found.push(0xd8);
  while (at + 1 < bytes.length) {
    const marker = bytes[at + 1] ?? 0;
    found.push(marker);
    if (marker === 0xd9) break;
    at += 2 + view.getUint16(at + 2);
    if (marker === 0xda) {
      while (
        !(
          bytes[at] === 0xff &&
          (bytes[at + 1] ?? 0) !== 0 &&
          ((bytes[at + 1] ?? 0) < 0xd0 || (bytes[at + 1] ?? 0) > 0xd7)
        )
      )
        at += 1;
    }
  }
  return found;
}

const SVG = ascii('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const GIF = ascii("GIF89a\x01\x00\x01\x00\x00\x00\x00;");
const WEBP = ascii("RIFF\x1a\x00\x00\x00WEBPVP8 ");
const HTML = ascii("<!doctype html><html><body>hello</body></html>");

describe("checkLogo: the type comes from the content (V5.2.2)", () => {
  it("accepts a PNG and reads its type and size from the header", () => {
    const image = accepted(checkLogo(png(40, 30)));
    expect(image).toMatchObject({ mediaType: "image/png", width: 40, height: 30 });
  });

  it("accepts a baseline JPEG and reads its type and size from the frame header", () => {
    const image = accepted(checkLogo(jpeg(33, 17)));
    expect(image).toMatchObject({ mediaType: "image/jpeg", width: 33, height: 17 });
  });

  it("accepts a progressive JPEG frame (SOF2)", () => {
    expect(accepted(checkLogo(jpeg(8, 8, { frameMarker: 0xc2 }))).mediaType).toBe("image/jpeg");
  });

  it.each([
    ["an SVG", SVG],
    ["an SVG with an XML declaration", ascii('<?xml version="1.0"?>\n<svg/>')],
    ["a GIF", GIF],
    ["a WebP", WEBP],
    ["an HTML page", HTML],
    ["an empty file", new Uint8Array()],
    ["a PNG signature cut short", Uint8Array.of(0x89, 0x50, 0x4e, 0x47)],
    ["a JPEG start without a marker after it", Uint8Array.of(0xff, 0xd8, 0x00)],
  ])("refuses %s as an unsupported type", (_name, bytes) => {
    expect(checkLogo(bytes)).toEqual({
      ok: false,
      fault: { kind: "logo_unsupported_type", detail: "signature" },
    });
  });

  it("reads a JPEG renamed to .png as a JPEG: the name plays no part (renamed file)", () => {
    // The check takes bytes only; the server function never passes the name on.
    expect(accepted(checkLogo(jpeg())).mediaType).toBe("image/jpeg");
    expect(accepted(checkLogo(png())).mediaType).toBe("image/png");
  });

  it.each([
    ["lossless (SOF3)", 0xc3],
    ["hierarchical (SOF5)", 0xc5],
    ["arithmetic (SOF9)", 0xc9],
  ])("refuses a JPEG with a %s frame as unsupported", (_name, marker) => {
    expect(checkLogo(jpeg(8, 8, { frameMarker: marker }))).toEqual({
      ok: false,
      fault: { kind: "logo_unsupported_type", detail: "jpeg_process" },
    });
  });

  it("refuses a 12-bit JPEG as unsupported", () => {
    expect(checkLogo(jpeg(8, 8, { frameMarker: 0xc1, precision: 12 }))).toEqual({
      ok: false,
      fault: { kind: "logo_unsupported_type", detail: "jpeg_process" },
    });
  });
});

describe("checkLogo: the limits (V5.2.1)", () => {
  /** A PNG padded to exactly `size` bytes with a private ancillary chunk. */
  function pngOfSize(size: number): Uint8Array {
    const base = png();
    return png(4, 4, { before: [pngChunk("prVt", new Uint8Array(size - base.length - 12))] });
  }

  it("accepts a file of exactly 512 KiB", () => {
    const bytes = pngOfSize(LOGO_MAX_BYTES);
    expect(bytes.length).toBe(LOGO_MAX_BYTES);
    expect(checkLogo(bytes).ok).toBe(true);
  });

  it("refuses a file one byte over 512 KiB before reading its type", () => {
    const bytes = pngOfSize(LOGO_MAX_BYTES + 1);
    expect(checkLogo(bytes)).toEqual({
      ok: false,
      fault: { kind: "logo_too_large", size: LOGO_MAX_BYTES + 1 },
    });
    expect(checkLogo(new Uint8Array(LOGO_MAX_BYTES + 1))).toMatchObject({
      fault: { kind: "logo_too_large" },
    });
  });

  it.each([
    [LOGO_MAX_SIDE, LOGO_MAX_SIDE],
    [1, LOGO_MAX_SIDE],
    [LOGO_MAX_SIDE, 1],
  ])("accepts a PNG of %i by %i", (width, height) => {
    expect(accepted(checkLogo(png(width, height)))).toMatchObject({ width, height });
  });

  it.each([
    [LOGO_MAX_SIDE + 1, 1],
    [1, LOGO_MAX_SIDE + 1],
    [0x7fff_ffff, 1],
  ])("refuses a PNG of %i by %i", (width, height) => {
    // Only the header: the check refuses before it reads any image data.
    expect(checkLogo(pngOf([ihdr(width, height), pngChunk("IEND")]))).toEqual({
      ok: false,
      fault: { kind: "logo_too_many_pixels", width, height },
    });
  });

  it.each([
    [LOGO_MAX_SIDE, LOGO_MAX_SIDE],
    [1, LOGO_MAX_SIDE],
  ])("accepts a JPEG of %i by %i", (width, height) => {
    expect(accepted(checkLogo(jpeg(width, height)))).toMatchObject({ width, height });
  });

  it.each([
    [LOGO_MAX_SIDE + 1, 8],
    [8, LOGO_MAX_SIDE + 1],
    [65_535, 65_535],
  ])("refuses a JPEG of %i by %i", (width, height) => {
    // The image cut after its frame header: the check refuses before it reads a scan.
    const frame = jpeg(width, height).subarray(0, 2 + 69 + 13);
    expect(checkLogo(frame)).toEqual({
      ok: false,
      fault: { kind: "logo_too_many_pixels", width, height },
    });
  });
});

describe("checkLogo: metadata is removed, pixels are kept (#292)", () => {
  const position = exifWithPosition();

  it("drops every PNG metadata chunk, the location in EXIF and XMP included", () => {
    const input = png(6, 6, { before: pngMetadataChunks(), after: pngMetadataChunks() });
    expect(contains(input, position)).toBe(true);
    const image = accepted(checkLogo(input));
    expect(chunkTypes(image.bytes)).toEqual(["IHDR", "IDAT", "IEND"]);
    expect(contains(image.bytes, position)).toBe(false);
    expect(contains(image.bytes, XMP_WITH_POSITION)).toBe(false);
    expect(contains(image.bytes, ascii("invented"))).toBe(false);
  });

  it("keeps the chunks that change how the pixels look, and the image data byte for byte", () => {
    const colour = [
      pngChunk("gAMA", Uint8Array.of(0, 0, 0xb1, 0x8f)),
      pngChunk("sRGB", Uint8Array.of(0)),
      pngChunk("cHRM", new Uint8Array(32)),
      pngChunk("cICP", Uint8Array.of(1, 13, 0, 1)),
    ];
    const data = idat(3, 3);
    const input = pngOf([ihdr(3, 3), ...colour, ...pngMetadataChunks(), data, pngChunk("IEND")]);
    const image = accepted(checkLogo(input));
    expect(chunkTypes(image.bytes)).toEqual([
      "IHDR",
      "gAMA",
      "sRGB",
      "cHRM",
      "cICP",
      "IDAT",
      "IEND",
    ]);
    expect(contains(image.bytes, data)).toBe(true);
  });

  it("keeps a palette and its transparency", () => {
    const raw = deflateSync(Uint8Array.of(0, 0));
    const input = pngOf([
      ihdr(1, 1, { colourType: 3 }),
      pngChunk("PLTE", Uint8Array.of(10, 20, 30)),
      pngChunk("tRNS", Uint8Array.of(128)),
      pngChunk("tEXt", ascii("Title\0x")),
      pngChunk("IDAT", raw),
      pngChunk("IEND"),
    ]);
    expect(chunkTypes(accepted(checkLogo(input)).bytes)).toEqual([
      "IHDR",
      "PLTE",
      "tRNS",
      "IDAT",
      "IEND",
    ]);
  });

  it.each<[string, Uint8Array]>([
    ["a gAMA chunk that carries text", pngChunk("gAMA", ascii("Made at the invented site"))],
    ["an sRGB chunk of two bytes", pngChunk("sRGB", Uint8Array.of(0, 1))],
    ["a tRNS chunk in an RGBA image", pngChunk("tRNS", ascii("invented"))],
  ])("drops %s: a kept type holds only its own fixed data", (_name, chunk) => {
    expect(accepted(checkLogo(png(2, 2, { before: [chunk] }))).bytes).toEqual(png(2, 2));
  });

  it("keeps the first of two gAMA chunks only", () => {
    const first = pngChunk("gAMA", Uint8Array.of(0, 0, 0xb1, 0x8f));
    const second = pngChunk("gAMA", Uint8Array.of(0, 1, 0x86, 0xa0));
    const image = accepted(checkLogo(png(2, 2, { before: [first, second] })));
    expect(image.bytes).toEqual(png(2, 2, { before: [first] }));
  });

  it("drops a tRNS chunk longer than the palette", () => {
    const input = pngOf([
      ihdr(1, 1, { colourType: 3 }),
      pngChunk("PLTE", Uint8Array.of(10, 20, 30)),
      pngChunk("tRNS", Uint8Array.of(1, 2)),
      pngChunk("IDAT", deflateSync(Uint8Array.of(0, 0))),
      pngChunk("IEND"),
    ]);
    expect(chunkTypes(accepted(checkLogo(input)).bytes)).toEqual(["IHDR", "PLTE", "IDAT", "IEND"]);
  });

  it("keeps only the listed chunk types", () => {
    expect([...PNG_KEPT_CHUNKS].sort()).toEqual(
      ["IDAT", "IEND", "IHDR", "PLTE", "cHRM", "cICP", "gAMA", "sRGB", "tRNS"].sort(),
    );
  });

  it("drops every JPEG metadata segment, the location in EXIF and XMP included", () => {
    const input = jpeg(16, 16, { before: jpegMetadataSegments() });
    expect(contains(input, position)).toBe(true);
    const image = accepted(checkLogo(input));
    expect(markers(image.bytes)).toEqual([0xd8, 0xdb, 0xc0, 0xc4, 0xc4, 0xda, 0xd9]);
    expect(contains(image.bytes, position)).toBe(false);
    expect(contains(image.bytes, ascii("Exif"))).toBe(false);
    expect(contains(image.bytes, XMP_WITH_POSITION)).toBe(false);
    expect(contains(image.bytes, ascii("invented"))).toBe(false);
    expect(contains(image.bytes, ascii("ICC_PROFILE"))).toBe(false);
  });

  it("keeps the fixed Adobe segment, and drops an APP14 that carries more", () => {
    const longer = jpegSegment(0xee, ascii("Adobe and an invented note"));
    const image = accepted(checkLogo(jpeg(8, 8, { before: [jpegAdobe(), longer] })));
    expect(markers(image.bytes)).toEqual([0xd8, 0xee, 0xdb, 0xc0, 0xc4, 0xc4, 0xda, 0xd9]);
    expect(contains(image.bytes, ascii("invented"))).toBe(false);
  });

  it("copies the entropy-coded data with its restart markers as it came", () => {
    const input = jpeg(64, 16, { restart: true, before: [jpegExif()] });
    const image = accepted(checkLogo(input));
    expect(image.bytes).toEqual(jpeg(64, 16, { restart: true }));
  });

  it("is idempotent: filtering the filtered image changes nothing", () => {
    for (const input of [
      png(5, 5, { before: pngMetadataChunks() }),
      jpeg(9, 9, { before: jpegMetadataSegments() }),
    ]) {
      const once = accepted(checkLogo(input)).bytes;
      expect(accepted(checkLogo(once)).bytes).toEqual(once);
    }
  });
});

describe("checkLogo: a polyglot is cut to its image (#292)", () => {
  it("drops an HTML page after the PNG's IEND", () => {
    const input = png(2, 2, { trailing: HTML });
    const image = accepted(checkLogo(input));
    expect(image.bytes).toEqual(png(2, 2));
    expect(contains(image.bytes, ascii("<html"))).toBe(false);
  });

  it("drops a script in a PNG text chunk", () => {
    const input = png(2, 2, { before: [pngChunk("tEXt", ascii("x\0<script>alert(1)</script>"))] });
    expect(contains(accepted(checkLogo(input)).bytes, ascii("<script"))).toBe(false);
  });

  it("drops a zip archive after the JPEG's EOI", () => {
    const zip = concatBytes(ascii("PK\x03\x04"), ascii("invented archive entry"));
    const image = accepted(checkLogo(jpeg(8, 8, { trailing: zip })));
    expect(image.bytes).toEqual(jpeg(8, 8));
  });

  it("drops an HTML page in a JPEG comment", () => {
    const input = jpeg(8, 8, { before: [jpegSegment(0xfe, HTML)] });
    expect(contains(accepted(checkLogo(input)).bytes, ascii("<html"))).toBe(false);
  });

  it("refuses an SVG with a PNG inside it: the first bytes decide", () => {
    expect(checkLogo(concatBytes(SVG, png()))).toMatchObject({
      fault: { kind: "logo_unsupported_type" },
    });
  });
});

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
