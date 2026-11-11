<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Security baseline

eduLIMS is designed, built and reviewed against OWASP's standards, read from
copies in this directory instead of the web. A copy does not change under you
between a review and the next, it carries the exact version a finding cites,
and an agent or a person can search it offline.

## The baseline

- **Target:** OWASP ASVS 5.0, **Level 2**. The reason, and the judgement of
  every requirement, is in [asvs-5.0-applicability.md](asvs-5.0-applicability.md).
- **Risk lists:** the OWASP Top 10:2025
  ([top-10-2025-mapping.md](top-10-2025-mapping.md)) and the OWASP API
  Security Top 10 2023 ([api-top-10-2023-mapping.md](api-top-10-2023-mapping.md)),
  each mapped to what eduLIMS does about it.
- **How-to guidance:** the OWASP Cheat Sheet Series and the OWASP Top 10
  Proactive Controls 2024.
- **The project rules** that carry this into daily work:
  [.claude/rules/auth-security.md](../../.claude/rules/auth-security.md)
  (authentication, authorisation, privacy, uploads) and
  [.claude/rules/ci-cd.md](../../.claude/rules/ci-cd.md) (the pipeline).

## What is vendored

Each tree under [vendor/](vendor/) is byte for byte what upstream publishes at
a pinned tag or commit. Its `PROVENANCE.md` lists the upstream URL, the tag,
the commit, the fetch date, the licence, and every file with its sha256. The
pins are also in [docs/VERSIONS.md](../VERSIONS.md).

| Tree | Document | Pin |
|---|---|---|
| [vendor/asvs/](vendor/asvs/) | OWASP ASVS 5.0.0: the English chapters (`en/`) and the machine-readable requirement list (`docs_en/`: JSON, flat JSON, CSV) | tag `v5.0.0_release` |
| [vendor/top10/](vendor/top10/) | OWASP Top 10:2025, English | a `master` commit (no 2025 tag exists) |
| [vendor/api-security/](vendor/api-security/) | OWASP API Security Top 10 2023, English | tag `v2.7.0` |
| [vendor/cheatsheets/](vendor/cheatsheets/) | 54 sheets of the OWASP Cheat Sheet Series | one `master` commit (the series has no releases) |
| [vendor/proactive-controls/](vendor/proactive-controls/) | OWASP Top 10 Proactive Controls 2024: the ten controls | tag `v4.0.0` |

All five are CC-BY-SA-4.0 (checked in each upstream repository): the upstream
licence file sits in each tree, the SPDX text is
[LICENSES/CC-BY-SA-4.0.txt](../../LICENSES/CC-BY-SA-4.0.txt), and `REUSE.toml`
annotates `docs/security/vendor/**`. Biome skips the trees, and
`.gitattributes` stores them unconverted so the sums hold on every checkout.
They are not published on the documentation site.

### The cheat sheets in the set

| Area | Sheets |
|---|---|
| Sign-in and sessions (better-auth, OIDC with PKCE) | Authentication, OAuth2, JSON_Web_Token, Session_Management, Cookie_Theft_Mitigation |
| Roles, ownership, classes as tenants | Authorization, Access_Control, Insecure_Direct_Object_Reference_Prevention, Multi_Tenant_Security, Authorization_Testing_Automation, Mass_Assignment |
| The browser | Cross-Site_Request_Forgery_Prevention, Cross_Site_Scripting_Prevention, DOM_based_XSS_Prevention, Content_Security_Policy, HTTP_Headers, HTTP_Strict_Transport_Security, Clickjacking_Defense, Unvalidated_Redirects_and_Forwards, Third_Party_Javascript_Management, Web_Cache_Security |
| Input, uploads, queries | Input_Validation, File_Upload, XML_External_Entity_Prevention (the `.xlsx` is zipped XML), SQL_Injection_Prevention, Query_Parameterization, Injection_Prevention, Server_Side_Request_Forgery_Prevention, REST_Security |
| Invitations (#28) | Email_Validation_and_Verification |
| Errors, logs, availability | Error_Handling, Logging, Logging_Vocabulary, Denial_of_Service |
| Secrets, cryptography, transport, database | Secrets_Management, Cryptographic_Storage, Transport_Layer_Security, Database_Security |
| Node.js, TypeScript, containers | Nodejs_Security, JavaScript_and_TypeScript_Security, Prototype_Pollution_Prevention, NPM_Security, Docker_Security, NodeJS_Docker |
| Supply chain and CI/CD | Software_Supply_Chain_Security, Vulnerable_Dependency_Management, Dependency_Graph_SBOM, CI_CD_Security, GitHub_Actions_Security |
| Design, review, privacy, disclosure | Threat_Modeling, Abuse_Case, Secure_Code_Review, User_Privacy_Protection, Vulnerability_Disclosure |

Left out on purpose: Forgot_Password, Password_Storage, Multifactor_Authentication
and Credential_Stuffing_Prevention (sign-in is SSO only; passwords and MFA live
at the identity provider), SAML_Security and LDAP_Injection_Prevention (OIDC
only), GraphQL, WebSocket and gRPC (not used), and the sheets for other
languages, frameworks and platforms.

Not vendored: the OWASP Top 10 CI/CD Security Risks. Its repository
(`OWASP/www-project-top-10-ci-cd-security-risks`) is the project's web page
with no release or tag, so it has no stable version to pin; the CI_CD_Security
and GitHub_Actions_Security sheets cover the same ground for this pipeline.

## How the pieces are used

- **Designing a feature:** read the ASVS chapter of the area (V5 for the Gen5
  upload, V8 for class membership in #28) and the matching cheat sheet before
  you write the plan; name the ASVS ids the feature has to meet in the issue.
- **Building it:** the rows of the applicability table say what the feature
  must do and how it is verified. When a test proves a row, change its status
  to `met` and cite the test in the same pull request.
- **Reviewing it:** the `security-reviewer` agent reviews against ASVS Level 2
  and the cheat sheets and cites requirement ids
  (`.claude/agents/security-reviewer.md`).
- **Looking something up:** the `/owasp-lookup` skill finds the ASVS
  requirement or the cheat sheet section for a topic and quotes it with its id
  and path. By hand: `grep -n 'V8.2.2' docs/security/vendor/asvs/en/*.md`, or
  `jq '.requirements[] | select(.req_id == "V8.2.2")'` over the flat JSON.

## Updating a vendored document

Never edit a file under `vendor/` by hand. Each tree has a fetch script:

```bash
bash scripts/vendor/owasp-asvs.sh                # fetch, verify the sums, replace the tree
bash scripts/vendor/owasp-asvs.sh --check        # re-fetch into a temp dir and diff
bash scripts/vendor/owasp-asvs.sh --sums         # print fresh sums for a pin update
```

The others are `owasp-top10.sh`, `owasp-api-security.sh`,
`owasp-cheatsheets.sh` and `owasp-proactive-controls.sh`; the shared code is
`scripts/vendor/lib.sh`. To move a pin, resolve the new tag and commit with
`gh api` (never from memory), change `TAG`, `COMMIT` and `FETCHED` in the
script, replace `FILES` with the `--sums` output (add or drop paths there),
run the script, and update the row in `docs/VERSIONS.md` in the same pull
request. After an ASVS update, run `node scripts/security/asvs-table.ts`:
new ids appear with `TODO` cells, which the `asvs-coverage` CI job refuses
until they are judged.

The pin freshness workflow (`.github/workflows/pin-freshness.yml`, weekly
and on manual dispatch) runs every script's `--check`, so a tag that moved or
a tree that drifted fails there and not on every pull request.
