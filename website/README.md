<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# The eduLIMS documentation site

The site at <https://edulims.eu> is an [Astro Starlight](https://starlight.astro.build/)
site in this pnpm workspace package (`@edulims/website`). The
[Docs workflow](../.github/workflows/docs.yml) builds and checks it on every
pull request and deploys it to GitHub Pages on every push to `main`.

## Commands

Run them from the repository root:

```sh
pnpm --filter @edulims/website dev          # sync, then a dev server on http://localhost:4321
pnpm --filter @edulims/website build        # sync, then the static site in website/dist
pnpm --filter @edulims/website check:links  # lychee over website/dist, offline
pnpm --filter @edulims/website check:a11y   # axe WCAG 2.1 A and AA scan of key pages
```

`check:a11y` needs Chromium once:
`pnpm --filter @edulims/website exec playwright install chromium`.
`check:links` installs the pinned lychee into `website/.bin` when none is on
the `PATH`.

## Where the content comes from

| Content | Source | Language |
|---|---|---|
| Landing page, introduction, quick start, user guides, configuration reference, citation | hand-written in `src/content/docs/` | English |
| Student, Teacher and Administrator guides, landing page | hand-written in `src/content/docs/nl/` | Dutch |
| Install, identity providers, upgrading, backups, verifying releases, and every Development page except the citation | generated from `docs/` and the root `CONTRIBUTING.md`, `SECURITY.md` and `AI_STATEMENT.md` | English |

English is the root locale (no `/en/` prefix) and Dutch lives under `/nl/`.
A page with no Dutch version is served under `/nl/` in English, with a notice
that it is available in English only.

### The docs sync

`docs/` stays the single source of truth for the design and operations
documents. `scripts/sync-docs.ts` runs before every `dev` and `build`, and
copies each source into `src/content/docs/` as a Starlight page:

- The title comes from the source's first `#` heading, and the edit link
  points at the source file, not at the copy.
- A `##` section named in the map at the top of the script becomes a page of
  its own: "Updating" and "Backups" from `docs/deployment.md`, for example.
  When a mapped section is missing, the sync fails and names the map entry
  to update, so a renamed heading cannot drop a page in silence.
- Relative links are rewritten: a link to another synced file goes to its
  page (with the anchor, and to the split-out page that now holds the
  anchor), an image or other file under `docs/` is copied to
  `public/_repo/` and served from there, and a link to any other file in the
  repository goes to that file on GitHub. A link that resolves to nothing
  fails the sync.

The generated pages and `public/_repo/` are gitignored, and every generated
page carries a marker comment, which the next sync uses to delete it. Edit
the source in `docs/` or the repository root, never the copy. A new document
in `docs/` appears on the site once it has an entry in the map in
`scripts/sync-docs.ts` and in the sidebar in `astro.config.mjs`.

The sync is a copy step and not an Astro content loader over `../docs`,
because the rewritten links, the split pages and the asset copies have to
exist before Astro reads the collection, and a copy keeps Starlight's own
loader, sidebar and fallback logic unchanged.

## What the site does without

No analytics, no cookies, and nothing loaded from another origin at runtime:
the fonts are the system fonts, and the search index (Pagefind) and the
Mermaid renderer are part of the build. The build also writes `llms.txt`
(`starlight-llms-txt`) and a sitemap.

## Accessibility fixes

- **Tables** get `tabindex="0"` from `src/plugins/rehype-focusable-tables.ts`,
  so a keyboard user can scroll a wide one.
- **The search button**: `public/search-label.js` gives it its visible word
  as its accessible name (WCAG 2.5.3, Label in Name).
