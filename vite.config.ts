// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 3000 },
  resolve: { tsconfigPaths: true },
  plugins: [
    // Compiles messages/*.json with the options in project.inlang/paraglide.config.ts.
    paraglideVitePlugin({ project: "./project.inlang" }),
    tailwindcss(),
    // `src/server-entry.ts` wraps the Start handler in the locale middleware; the default
    // name `server` would collide with the `src/server/` directory.
    tanstackStart({ server: { entry: "./server-entry.ts" } }),
    // The retention prune (B4, #65) runs inside the server process.
    nitro({ plugins: ["./src/server/plugins/retention-prune.ts"] }),
    viteReact(),
  ],
});
