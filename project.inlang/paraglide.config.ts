// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Paraglide compiler options, shared by the Vite plugin (`pnpm dev`, `pnpm build`) and the CLI
// (`pnpm i18n`, which typecheck and the unit tests run first).
import { defineConfig } from "@inlang/paraglide-js";

export default defineConfig({
  outdir: "./src/i18n",
  // NOTE: no requirement governs this: our own design (ADR 0011). The client reads the locale
  // the server rendered from `<html lang>` so hydration always matches the SSR output.
  strategy: ["cookie", "custom-documentLang", "preferredLanguage", "baseLocale"],
  cookieName: "EDULIMS_LOCALE",
  cookieSameSite: "lax",
  cookieSecure: "auto",
  // Physical message files, so tsc, Vitest and plain Node resolve them without the Vite plugin.
  outputStructure: "message-modules",
  emitTsDeclarations: true,
  emitReadme: false,
  emitPrettierIgnore: false,
});
