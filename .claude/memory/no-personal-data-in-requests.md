---
name: no-personal-data-in-requests
description: "No session or worker sends the owner's name, e-mail or any personal contact to an external service, User-Agent headers included; use a neutral agent string such as edulims-check; carried from the Ferro family"
metadata:
  type: feedback
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

Every external call (the npm registry, GitHub raw content, a specification
site, an MCP server) uses a neutral User-Agent such as `edulims-check` and
carries no personal contact. Some registries ask for contact details in the
User-Agent; do not follow that.

**Why:** a request header is stored in the service's logs, outside the
owner's control. On FerroFED a worker once sent the owner's e-mail in a
User-Agent.

**How to apply:** every worker brief that may query an external API says so.
Personal data of students never leaves the eduLIMS database at all
(`.claude/rules/auth-security.md`). A slip is reported to the owner, never
hidden.
