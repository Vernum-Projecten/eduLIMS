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
| `afinion-2-hl7-connectivity-protocol-v4.0-2021-01.pdf` | Afinion 2 – HL7 Connectivity Protocol, Doc. ID TP13/80/2094/2103/2722-13155, version 4.0, 25.01.2021 (8 pages), marked "No Restriction" on its title page | supplied by the owner, as received from the analyser's supplier under the file name `2000550 v03 Afinion 2_HL7 Connectivity Protocol.pdf` | 2026-11-19 | `f0a0fca81b2f6922fe0eb62dcc7478910a68368812f95d01b02448d9e864495c` |

## What the manual settles

Chapter "Configuration", Tables 1 and 2: the analyser's network settings are
DHCP, web server, IP address, gateway, network mask and host name; its
connectivity settings are the protocol (ASTM HL, ASTM LL, HL7 "based on HL7
version 2.4", POCT1-A), which results to send, server IP, port, receiving
application, receiving facility and the patient ID field. It has no TLS, no
encryption and no certificate setting; chapter "Connectivity" asks that the
analyser "communicates with the external information system over a secure
network".

## What the protocol settles

The protocol covers the Afinion 2 Analyzer with software version 21.07 and
newer (§1).

- **Transport (§1.4):** each message is sent over a socket as
  `<VT>message<FS><CR>` (0x0B, 0x1C, 0x0D), and the analyser expects an ACK
  framed the same way. The document names no TLS and no authentication.
- **Messages (§2):** the structure is "based on Version 2.4" of HL7. The
  analyser sends ORU^R01 with the segments MSH, PID, PV1, OBR and OBX, and
  receives an ACK with MSH and MSA. EVN is not supported (§3.3).
- **MSH (§3.2):** sending application "Afinion 2 Analyzer"; receiving
  application (MSH-5) and facility (MSH-6) are configured on the analyser;
  MSH-10 is a consecutive number starting at 1000; MSH-11 is `P` for a patient
  result and `Q` for a quality control result; MSH-12 is "2.4"; MSH-18 is
  "8859/1".
- **MSA (§3.4):** the analyser accepts `AA` and `CA`. It does not verify the
  message control ID and does not read the error text; any other code is
  saved to its log.
- **The entered patient ID (§3.5, §3.6):** it goes out in PID-3 or in PV1-19,
  "configurable, to use PID or visitnumber". The message carries one patient
  ID; examples 4.1.1 and 4.1.2 show the two placements, and example 4.1.8
  shows a value of 16 digits.
- **OBR (§3.7):** OBR-4 is the name of the assay, OBR-15 the specimen source
  (`ORH`, `BLDC`, `BLDV`), OBR-23.2 the reagent lot, OBR-25 always `F`.
- **OBX (§3.8):** one OBX per analyte with the name in OBX-3, the value in
  OBX-5, the unit in OBX-6, the result status in OBX-11 (always `F`), the
  operator ID in OBX-16, the analyser's serial number in OBX-18 and the time
  of the measurement in OBX-19. The value type in OBX-2 is `ST`.
- **Results outside the measuring range (§3.8):** OBX-8 carries `<` or `>`
  and OBX-5 carries the comparator with the limit; "Only '<' and '>' will be
  supported". A value that cannot be calculated or measured is `--- ` in
  OBX-5.
- **Examples (§4.1):** nine ORU^R01 messages, for CRP, ACR, the lipid panel
  and HbA1c, among them a quality control result (4.1.8).
