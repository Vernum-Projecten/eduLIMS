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

/**
 * The address a screen shows a lab's logo from: {@link labLogoPath} with the logo's version, so a
 * replaced logo is a new address and the browser does not keep showing the old image (#293).
 */
export function labLogoSrc(labId: string, version: string): string {
  return `${labLogoPath(labId)}?v=${encodeURIComponent(version)}`;
}

/**
 * The browser's own check of a chosen file before it is sent (#293): the declared type and the
 * size. It only spares the teacher a wasted upload; the server ignores both and decides by the
 * content (ASVS 5.0 V2.2.2). A file the browser gives no type passes the type check, since a real
 * PNG or JPEG can arrive that way; the server then judges it.
 */
export function precheckLogoFile(file: {
  readonly type: string;
  readonly size: number;
}): Extract<LogoRefusal, "logo_unsupported_type" | "logo_too_large"> | null {
  const known = file.type === "" || (LOGO_MEDIA_TYPES as readonly string[]).includes(file.type);
  if (!known) return "logo_unsupported_type";
  if (file.size > LOGO_MAX_BYTES) return "logo_too_large";
  return null;
}
