#!/usr/bin/env bash
# SPDX-FileCopyrightText: Ruben Talstra
# SPDX-License-Identifier: Apache-2.0
#
# Vendors the English markdown of the OWASP Top 10:2025 into
# docs/security/vendor/top10/. Upstream publishes the 2025 edition from master
# without a release tag, so the pin is a commit.
#
#   bash scripts/vendor/owasp-top10.sh            # fetch, verify, replace the tree
#   bash scripts/vendor/owasp-top10.sh --check    # re-fetch and diff (CI, weekly)
#   bash scripts/vendor/owasp-top10.sh --sums     # fresh sums, for a pin update
#
# A pin update changes TAG, COMMIT and FETCHED together, replaces FILES with
# the --sums output, re-runs the script, and updates docs/VERSIONS.md.
set -euo pipefail

NAME="top10"
TITLE="OWASP Top 10:2025"
REPO="OWASP/Top10"
TAG=""
COMMIT="3a31f35346c3f4e90f350395124382fa53af2afe"
FETCHED="2026-11-11"
STRIP="2025/docs/en/"
LICENCE="CC-BY-SA-4.0"
CONSUMER="docs/security/top-10-2025-mapping.md, .claude/rules/auth-security.md, the security-reviewer agent and the /owasp-lookup skill."
FILES="\
fd5524ce899b86f8a02c8de7005a6d22113f465a8262fd8b86e0e1d28c0f6f45  LICENSE
71e4b9124e768a954b4d5b9b6f952dd39fa6044688e8dd5ef7b5aa990a3c7c16  2025/docs/en/0x00_2025-Introduction.md
ea3525fc08b1ed1b4a6fbbb605a6c2773bd6f6bb32caec1b14a6c06bf3bba1c1  2025/docs/en/0x01_2025-About_OWASP.md
6bc3550cc066cbee3198a6397037b1c47bfd6bb5bfbf20a5d7f96be586fbfd7f  2025/docs/en/0x02_2025-What_are_Application_Security_Risks.md
bbb8f5fba26344bf8ea567f524fb62d4be3bb5e7cfa9af5839e1edd71c378b5b  2025/docs/en/0x03_2025-Establishing_a_Modern_Application_Security_Program.md
d6ebc4e65422ff4fa32c310dec3c20ed6e804edfd2d06c7e5b8a802645f556ec  2025/docs/en/A01_2025-Broken_Access_Control.md
0df66f6c3e23ee8234567b20de786bf579dac1561632dd532d64130bb2aa2d75  2025/docs/en/A02_2025-Security_Misconfiguration.md
d4108c04991ef2f5ab1d8ef301b51cfeef0fea35c550665c3dcfba7aa346758e  2025/docs/en/A03_2025-Software_Supply_Chain_Failures.md
43d7da6637dc9d7ad7d9f7a017afc36123beb96c13d4e35d986f89bca341eaad  2025/docs/en/A04_2025-Cryptographic_Failures.md
d617676bd8d03ab656a481d97a3e8abd2a6241f22ea10326ad05120ba07494ec  2025/docs/en/A05_2025-Injection.md
e2b2f572b43ed5a4a82d2b1207c067687c321ecc683893f6bd4c2d2d467e22e4  2025/docs/en/A06_2025-Insecure_Design.md
9f98e0c8f055b0c87b67078ae9af4799a9f8caf0736a3fdcd66b1b092b1c60da  2025/docs/en/A07_2025-Authentication_Failures.md
3739748e2cb72c3935dbab9236ac5cb5061da39a1891362369af0c27102a26ca  2025/docs/en/A08_2025-Software_or_Data_Integrity_Failures.md
87121126d307ea09dbf073b090609c861c9ded6dc654f73c5ea6436b9522e9c8  2025/docs/en/A09_2025-Security_Logging_and_Alerting_Failures.md
1e05837530582feb3e96d84160cd2286d5ba93348fedca2d8f8fb35eecc27ac4  2025/docs/en/A10_2025-Mishandling_of_Exceptional_Conditions.md
d0401894e114e3cd13000bf282cb08bbbef06822f646708491f0f298d001b241  2025/docs/en/X01_2025-Next_Steps.md
1453d2fdbd268031b13a9e89619fb044b5e92373c3e26c2fb9f633a22df26e65  2025/docs/en/index.md
"

# shellcheck source=scripts/vendor/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
vendor_main "$@"
