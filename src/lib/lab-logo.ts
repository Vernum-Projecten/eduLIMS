// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The lab logo (D10, ADR 0021): the types and limits the server checks, and the codes of a
// refused upload, shared with the screen that states them (#293).

// NOTE: maintainer on #280 and #292; PNG or JPEG, at most 512 KiB and 1024 by 1024 pixels.
/** The most bytes an uploaded logo file takes. */
export const LOGO_MAX_BYTES = 512 * 1024;
/** The most pixels a logo takes in either direction. */
export const LOGO_MAX_SIDE = 1024;

/** The media types a logo is stored and served as, decided by its content. */
export const LOGO_MEDIA_TYPES = ["image/png", "image/jpeg"] as const;
export type LogoMediaType = (typeof LOGO_MEDIA_TYPES)[number];

/**
 * Why an uploaded logo was refused: not a PNG or a JPEG the server reads (SVG included), over
 * {@link LOGO_MAX_BYTES}, over {@link LOGO_MAX_SIDE} in either direction, or a PNG or JPEG whose
 * structure is broken.
 */
export const LOGO_REFUSALS = [
  "logo_unsupported_type",
  "logo_too_large",
  "logo_too_many_pixels",
  "logo_malformed",
] as const;
export type LogoRefusal = (typeof LOGO_REFUSALS)[number];

/** The URL a lab's logo is served at; the server answers it only to the lab and its teachers. */
export function labLogoPath(labId: string): string {
  return `/api/labs/${encodeURIComponent(labId)}/logo`;
}
