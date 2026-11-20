// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The one check of an uploaded lab logo (D10, #292; ASVS 5.0 V5.2.1, V5.2.2): the size first,
// then the type from the first bytes, never from the file name or the declared type, then the
// format's own check and metadata filter. SVG, GIF, WebP and everything else is refused.
import "@tanstack/react-start/server-only";
import { LOGO_MAX_BYTES } from "../../lib/lab-logo.ts";
import { filterJpeg, isJpeg } from "./jpeg.ts";
import { filterPng, isPng } from "./png.ts";
import { fault, type ImageCheck } from "./types.ts";

/**
 * Returns the logo with its metadata removed and its type, width and height read from its
 * content, or the reason it is refused.
 */
export function checkLogo(bytes: Uint8Array): ImageCheck {
  if (bytes.length > LOGO_MAX_BYTES) return fault({ kind: "logo_too_large", size: bytes.length });
  if (isPng(bytes)) return filterPng(bytes);
  if (isJpeg(bytes)) return filterJpeg(bytes);
  return fault({ kind: "logo_unsupported_type", detail: "signature" });
}
