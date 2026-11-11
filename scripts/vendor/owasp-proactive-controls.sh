#!/usr/bin/env bash
# SPDX-FileCopyrightText: Ruben Talstra
# SPDX-License-Identifier: Apache-2.0
#
# Vendors the OWASP Top 10 Proactive Controls 2024 (tag v4.0.0) into
# docs/security/vendor/proactive-controls/: the ten controls, the index and the
# final word. The introduction pages (news, contributing) are left out.
#
#   bash scripts/vendor/owasp-proactive-controls.sh            # fetch, verify, replace the tree
#   bash scripts/vendor/owasp-proactive-controls.sh --check    # re-fetch and diff (CI, weekly)
#   bash scripts/vendor/owasp-proactive-controls.sh --sums     # fresh sums, for a pin update
#
# A pin update changes TAG, COMMIT and FETCHED together, replaces FILES with
# the --sums output, re-runs the script, and updates docs/VERSIONS.md.
set -euo pipefail

NAME="proactive-controls"
TITLE="OWASP Top 10 Proactive Controls 2024 (v4.0.0)"
REPO="OWASP/www-project-proactive-controls"
TAG="v4.0.0"
COMMIT="e5bceb0399a5e9a6182ea996d98acfe78a801d7b"
FETCHED="2026-11-11"
STRIP="docs/"
LICENCE="CC-BY-SA-4.0"
CONSUMER="docs/security/README.md (design guidance), the security-reviewer agent and the /owasp-lookup skill."
FILES="\
28a9529c7d0bb4dc51f4bf5c116a3d16ef247a052f7591466768ddf563fd1cf5  LICENSE
9359b0ac06e3f24d7cdbdc3de6911a8e740cb5e08e715d0ad2c437d835c4519a  docs/index.md
eb7f4087e9bbcb86dbc5c3ed173757eadc728ed437a4f234d56118ca5a24940b  docs/final-word.md
e3f1962e134db9178eb0c8c3cb21f30e07c36ca3aaa4608bce5eaf0446d87d1c  docs/the-top-10/c1-accesscontrol.md
c66f01fc26a3ded3bc106507c1fc06d0d03da8c4bb8add865fc26ddcf2727a56  docs/the-top-10/c10-stop-server-side-request-forgery.md
c5ae7248de46bd3bfca9a4460556d4fa3f8499779f124930fd9b2225c1e1ff21  docs/the-top-10/c2-crypto.md
0f615ca84d6c62c046e78fcc4310ec22a2655378b161b4862de467ec45fc677e  docs/the-top-10/c3-validate-input-and-handle-exceptions.md
a05a0983781365c2303ad49f57800c52465401cdfde5edc46026449ebdfea824  docs/the-top-10/c4-secure-architecture.md
4dee18fee58143bf02eeb22461ee4c9310441c11b4a76b9328eba5b7c226f219  docs/the-top-10/c5-secure-by-default.md
ba60b7f5d5ffd86006ba61f72bbe4c7e90fbb86dbd5761f3c35a70ad0367eaad  docs/the-top-10/c6-use-secure-dependencies.md
12dbde1b0a0f16379df5b8386a83826af6c776acef81ab0dd8e6a6ffaa957941  docs/the-top-10/c7-secure-digital-identities.md
0e479f2d93af88f7ba06c372df4490d4a7bebcf72fdba76f1821aa736aacca21  docs/the-top-10/c8-leverage-browser-security-features.md
1e9bdc052f71b54a46d99098a747c9d860c0dab1b54a15bc0bd504b813f86c8b  docs/the-top-10/c9-security-logging-and-monitoring.md
10ba1e77937e09db07a061cb444b9927a2580f561281ed0f56177a6bd0ace311  docs/the-top-10/index.md
"

# shellcheck source=scripts/vendor/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
vendor_main "$@"
