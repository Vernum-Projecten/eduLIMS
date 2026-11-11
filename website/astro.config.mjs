// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The eduLIMS documentation site, served at https://edulims.eu with no base path.
import { unified } from "@astrojs/markdown-remark";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import mermaid from "astro-mermaid";
import starlightLlmsTxt from "starlight-llms-txt";
import { rehypeFocusableTables } from "./src/plugins/rehype-focusable-tables.ts";

const repository = "https://github.com/Vernum-Projecten/eduLIMS";

export default defineConfig({
  site: "https://edulims.eu",
  trailingSlash: "always",
  // Mermaid's renderer and its optional layouts are code-split chunks over the 500 kB
  // default; a page loads them only when it holds a diagram.
  vite: { build: { chunkSizeWarningLimit: 1600 } },
  markdown: { processor: unified({ rehypePlugins: [rehypeFocusableTables] }) },
  integrations: [
    // astro-mermaid registers its remark plugin, so it comes before Starlight.
    mermaid({ autoTheme: true }),
    starlight({
      title: "eduLIMS",
      description:
        "An open-source laboratory information management system for practical laboratory education.",
      logo: { src: "./src/assets/logo.svg" },
      favicon: "/favicon.svg",
      head: [{ tag: "script", attrs: { src: "/search-label.js", defer: true } }],
      social: [{ icon: "github", label: "GitHub", href: repository }],
      editLink: { baseUrl: `${repository}/edit/main/website/` },
      lastUpdated: false,
      // src/pages/404.astro renders the not-found page as a splash page of its own.
      disable404Route: true,
      defaultLocale: "root",
      locales: {
        root: { label: "English", lang: "en" },
        nl: { label: "Nederlands", lang: "nl" },
      },
      sidebar: [
        {
          label: "Get started",
          translations: { nl: "Aan de slag" },
          items: ["get-started/introduction", "get-started/quick-start"],
        },
        {
          label: "User guides",
          translations: { nl: "Handleidingen" },
          items: ["guides/student", "guides/teacher", "guides/administrator"],
        },
        {
          label: "Operations",
          items: [
            "operations/install",
            "operations/configuration",
            "operations/identity-providers",
            "operations/upgrading",
            "operations/backups",
            "operations/verifying-releases",
          ],
        },
        {
          label: "Development",
          translations: { nl: "Ontwikkeling" },
          items: [
            "development/architecture",
            "development/requirements",
            "development/test-strategy",
            "development/kpi-dashboard",
            {
              label: "Decisions",
              translations: { nl: "Besluiten" },
              collapsed: true,
              items: [{ autogenerate: { directory: "development/decisions" } }],
            },
            "development/versions",
            "development/contributing",
            "development/ci-cd",
            "development/release",
            "development/security",
            "development/ai-statement",
            "development/cite",
          ],
        },
      ],
      plugins: [starlightLlmsTxt()],
    }),
  ],
});
