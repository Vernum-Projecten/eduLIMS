---
name: brand-and-ui
description: "The Microplate brand (indigo tile, amber sample well) in assets/brand/; UI is built from shadcn/ui components and blocks, polished and user-friendly end to end; owner 2026-11-11"
metadata:
  type: feedback
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

- **Brand:** the owner chose the "Microplate" mark: a 4×3 grid of wells of a
  96-well plate on an indigo tile (`#3730a3` family) with one amber sample
  well (`#fbbf24` family). The kit, tokens and contrast check live in
  `assets/brand/` like FerroTERM's; the README header is centred with the
  lockup and grouped badges, the name shown once.
- **UI:** use shadcn/ui's own components and blocks (the sidebar blocks for
  the app shell, `login-02` for the login page) rather than hand-built ones;
  the standard component set is in `src/components/ui/`. The owner wants the
  UI "100% proper", end to end, so it looks and feels user-friendly.
- **Language menu:** one compact dropdown in the header with the endonyms
  ("English", "Nederlands"), no flags, each item with its own `lang`; the
  choice is an account preference, the cookie only for anonymous visitors.

**Why:** owner decisions, 2026-11-11.

**How to apply:** add components with the shadcn CLI and keep
`src/components/ui/` identical to the registry; compose feature components
around them; hold every screen to `.claude/rules/react-ui.md`.
