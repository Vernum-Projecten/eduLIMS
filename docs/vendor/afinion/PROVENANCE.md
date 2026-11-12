<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Provenance: Abbott Afinion 2 documentation

The documents eduLIMS relies on for the Afinion 2 route (S5), kept so every
HL7 decision can be checked against its source (#209). Never edit a document
here; a new edition is a new file with its own row below.

- Licence: © Abbott, all rights reserved
  (`LICENSES/LicenseRef-Abbott-All-Rights-Reserved.txt`, annotated in
  `REUSE.toml`). Vendored for reference with the maintainer's approval on #131
  (2026-11-12). Not part of the documentation site and not redistributed
  elsewhere.
- Consumers: `.claude/rules/integration.md`, ADR 0013, `docs/deployment.md`
  ("The MLLP port"), and the HL7 work under #158.

## Files

| File | Title, number and revision | Source | Fetched | sha256 |
|---|---|---|---|---|
| `afinion-2-user-manual-1117346-rev-a-2023-02.pdf` | Afinion™ 2 User Manual, 1117346 Rev. A, 2023/02 (32 pages) | <https://www.ruh.nhs.uk/pathology/documents/poct/SOP_Abbott_Afinion_2_User_Manual.pdf>, a copy a hospital trust publishes | 2026-11-12 | `fe4b8c22b01519b1dc95777a3ce1c443b0111ebc9c85203bd5c341a0ece72c92` |

## What the manual settles

Chapter "Configuration", Tables 1 and 2: the analyser's network settings are
DHCP, web server, IP address, gateway, network mask and host name; its
connectivity settings are the protocol (ASTM HL, ASTM LL, HL7 "based on HL7
version 2.4", POCT1-A), which results to send, server IP, port, receiving
application, receiving facility and the patient ID field. It has no TLS, no
encryption and no certificate setting; chapter "Connectivity" asks that the
analyser "communicates with the external information system over a secure
network".

## Still missing

The Afinion 2 HL7 communication protocol data sheet, which defines the
messages, segments and fields. The manual says it is "available at
www.globalpointofcare.abbott or by contacting your local Afinion 2 supplier";
#209 stays open for it.
