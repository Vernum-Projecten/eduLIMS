#!/usr/bin/env bash
# SPDX-FileCopyrightText: Ruben Talstra
# SPDX-License-Identifier: Apache-2.0
#
# Vendors the English markdown of the OWASP API Security Top 10 2023 edition
# into docs/security/vendor/api-security/. The project's newest release tag,
# v2.7.0, carries the 2023 edition unchanged on master.
#
#   bash scripts/vendor/owasp-api-security.sh            # fetch, verify, replace the tree
#   bash scripts/vendor/owasp-api-security.sh --check    # re-fetch and diff (CI, weekly)
#   bash scripts/vendor/owasp-api-security.sh --sums     # fresh sums, for a pin update
#
# A pin update changes TAG, COMMIT and FETCHED together, replaces FILES with
# the --sums output, re-runs the script, and updates docs/VERSIONS.md.
set -euo pipefail

NAME="api-security"
TITLE="OWASP API Security Top 10 2023"
REPO="OWASP/API-Security"
TAG="v2.7.0"
COMMIT="c697e4d031b7a4966863a4923f46d9c666c4b449"
FETCHED="2026-11-11"
STRIP="editions/2023/en/"
LICENCE="CC-BY-SA-4.0"
CONSUMER="docs/security/api-top-10-2023-mapping.md, the security-reviewer agent and the /owasp-lookup skill."
FILES="\
9cff5eeb59f0a5f06d7cbe4c2435e7bbbce4edaab1d97b66324104f60a527cb7  LICENSE
9e6d55d6531b4b76353d56967b600fb370a777803e05684c8744b7502f0c2e07  editions/2023/en/0x00-header.md
674a7e9d3096a3957cfd5380fec4af5d335f904d514ef9b5a0397cfe8e21006e  editions/2023/en/0x00-notice.md
4b7ba47fb9bd09efbd42e0fffe9293fb98b87100688c3a5f70db0d9e76960d84  editions/2023/en/0x00-toc.md
9afd8d2bd7f38af574e579220a57d17548f04bfb4e1e82e66c9e69170201da19  editions/2023/en/0x01-about-owasp.md
e2045f36a868503dbc16fd0b1832ce94ea62ff945a361613a30eac87e19abd7f  editions/2023/en/0x02-foreword.md
c85ad2b0a5fa45e23f1611a1a33b3d8322c25dec6f1cac97c18a796eca6a3f48  editions/2023/en/0x03-introduction.md
cd0defe84e70a8121ebe8de7eff11880a7125a53e0dddf08c7b653f589e5b7b6  editions/2023/en/0x04-release-notes.md
4691516bc9053e631f517e6a7800682d6006afdb693d9b8da80500e59ad8ee3c  editions/2023/en/0x10-api-security-risks.md
c396a9fc70a64ea6bccba608b482a99750f00f0ad6c283d6fbdd5c4d936040a3  editions/2023/en/0x11-t10.md
f5a827897509a005095c306d05e56b8dc713717a78cb5360a2ba4b3c29bf4b2b  editions/2023/en/0xa1-broken-object-level-authorization.md
9c15446740599f7bcf709a406ca5627028793e701dd1798ba711a95e9b933971  editions/2023/en/0xa2-broken-authentication.md
d316b89ee31f4689d4a4fafd1b97b62b7d05ac880945a478991ae4abf64a961d  editions/2023/en/0xa3-broken-object-property-level-authorization.md
8df9df403fd0007bc28bd9a9a60e46739c6797b1f7135c7f0f683a7362f40e38  editions/2023/en/0xa4-unrestricted-resource-consumption.md
bdaf0f1f0ec6e527c0c30aaca50a7328ed5b3c386bf6ab86e878116f4a3dd808  editions/2023/en/0xa5-broken-function-level-authorization.md
b499f299f634b20557d0f9e335b105d6a738039fe5436b3eb09fe7f74ce63a27  editions/2023/en/0xa6-unrestricted-access-to-sensitive-business-flows.md
f1abf2f9d55a0b50a2004e44bc2ea95348c41452197bc5d1bc7dd71b70f52e6c  editions/2023/en/0xa7-server-side-request-forgery.md
13b9629746921f2ccd6fac1364cdfbb50f10d7b11faf668589d9994716c333de  editions/2023/en/0xa8-security-misconfiguration.md
8d5d7e6130fac2b28f5808508d4f90683d99ae5a37f9d3d0d9714c853c39ca4f  editions/2023/en/0xa9-improper-inventory-management.md
b5fe9034253ca2d7f7c4c9ef0a6db2b71da1689490911a5bb1f5aad2cab78706  editions/2023/en/0xaa-unsafe-consumption-of-apis.md
ede656cc1ab9853fe028d8d799a36626b96b91e7ef27ca62c9374835b4d6847e  editions/2023/en/0xb0-next-devs.md
d326adeaf2b5abcb8f65d308ffd890acf601b1294a4402b92ea219a369022e24  editions/2023/en/0xb1-next-devsecops.md
ad221004a2f113fc9c758401aa1e4021e53f522b05565234fdee6a8ebaf275fa  editions/2023/en/0xd0-about-data.md
d0d41c267ea3f822592f45fc804045255446beb50de0a33727af07d062022386  editions/2023/en/0xd1-acknowledgments.md
"

# shellcheck source=scripts/vendor/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
vendor_main "$@"
