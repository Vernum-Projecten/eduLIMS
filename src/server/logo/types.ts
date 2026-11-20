// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The result of checking and filtering an uploaded logo: the image to store, or why it was
// refused. Every refusal is a code, so a log line or the activity log never carries content.
import type { LogoMediaType, LogoRefusal } from "../../lib/lab-logo.ts";

/** Where a PNG or a JPEG broke its format; a code for the log, never shown to the user. */
export type MalformedAt =
  | "truncated"
  | "png_chunk_length"
  | "png_chunk_type"
  | "png_crc"
  | "png_ihdr"
  | "png_order"
  | "png_plte"
  | "png_critical_chunk"
  | "png_no_idat"
  | "png_no_iend"
  | "jpeg_marker"
  | "jpeg_segment_length"
  | "jpeg_frame"
  | "jpeg_scan"
  | "jpeg_table"
  | "jpeg_no_frame"
  | "jpeg_no_scan"
  | "jpeg_no_eoi";

/** Why a logo was refused, with the code of {@link LogoRefusal} it maps to. */
export type ImageFault =
  | { readonly kind: "logo_too_large"; readonly size: number }
  | { readonly kind: "logo_unsupported_type"; readonly detail: "signature" | "jpeg_process" }
  | { readonly kind: "logo_too_many_pixels"; readonly width: number; readonly height: number }
  | { readonly kind: "logo_malformed"; readonly at: MalformedAt };

/** A logo that passed the checks, with its metadata removed and its pixels as they came. */
export interface FilteredImage {
  readonly mediaType: LogoMediaType;
  readonly width: number;
  readonly height: number;
  readonly bytes: Uint8Array;
}

/** The outcome of checking one logo. */
export type ImageCheck =
  | { readonly ok: true; readonly image: FilteredImage }
  | { readonly ok: false; readonly fault: ImageFault };

/** Returns a refusal. */
export function fault(value: ImageFault): ImageCheck {
  return { ok: false, fault: value };
}

/** Returns a malformed-file refusal at `at`. */
export function malformed(at: MalformedAt): ImageCheck {
  return fault({ kind: "logo_malformed", at });
}

/** Returns the refusal code of a fault (compile-time check that every kind is a refusal). */
export function refusalOf(value: ImageFault): LogoRefusal {
  return value.kind;
}
