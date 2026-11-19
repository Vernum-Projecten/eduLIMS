<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Afinion 2 HL7 fixtures

Simulated HL7 v2.4 messages of the Abbott Afinion 2, for the tests of the
Afinion route (S5, risk P-02, #159). They follow the Afinion 2 HL7
Connectivity Protocol v4.0, vendored in `docs/vendor/afinion/`; the sections
below are that document's.

| File | What it is | Protocol |
|---|---|---|
| `crp-patient-pid3.hl7` | A CRP patient result (`MSH-11` P), the lab number in PID-3 | §3.5, §4.1.1, §4.1.2 |
| `crp-patient-pv1-19.hl7` | The same kind of result, the lab number in PV1-19 and PID-3 empty | §3.6, §4.1.1 |
| `crp-qc.hl7` | A CRP quality control result (`MSH-11` Q) | §3.2, §4.1.8 |
| `hba1c-patient.hl7` | An HbA1c patient result | §3.8, §4.1.8 |
| `hba1c-qc.hl7` | An HbA1c quality control result, `MSH-5` and `MSH-6` empty | §3.2, §4.1.8 |
| `hba1c-above-range.hl7` | HbA1c above the measuring range: `>15.0` in OBX-5, `>` in OBX-8 | §3.8, §4.1.9 |
| `hba1c-no-patient-id.hl7` | No patient ID and no operator ID entered (#163) | §4.1.9 |
| `acr-below-range.hl7` | ACR with albumin and creatinine, two values below the range with `<` | §3.8, §4.1.3 |
| `acr-no-value.hl7` | An ACR that cannot be calculated: `--- ` in OBX-5 | §3.8, §4.1.4 |
| `lipid-panel.hl7` | The six analytes of the lipid panel; Chol/HDL has no unit | §4.1.5 |
| `ack-aa.hl7` | The ACK with `MSA-1` AA for `crp-patient-pid3.hl7` | §2.3, §3.4 |
| `ack-ca.hl7` | The same ACK with `MSA-1` CA | §2.3, §3.4 |

Every segment ends with a carriage return (0x0D) and there is no line feed,
so `.gitattributes` keeps the files byte for byte (`-text`). The bytes are
ASCII only, which makes them the same in ISO 8859-1, the character set
`MSH-18` names. Send them as bytes, never as a re-encoded string.

## Made by the builder

`afinion-oru.ts` builds an ORU^R01 or an ACK from typed input, and
`afinion-fixtures.ts` holds the input of every file here.
`tests/unit/afinion-hl7-fixtures.test.ts` builds each one and compares it
with its file byte for byte, so a file cannot drift from the builder. To
change a fixture, change its input and write the files again:

```sh
node --input-type=module -e '
const { buildAllFixtures } = await import("./tests/fixtures/hl7/afinion-fixtures.ts");
const { messageBytes } = await import("./tests/fixtures/hl7/afinion-oru.ts");
const { writeFileSync } = await import("node:fs");
for (const [name, text] of buildAllFixtures())
  writeFileSync(`tests/fixtures/hl7/${name}`, messageBytes(text));
'
```

A test that needs another message (another lab number, a refused ACK)
builds it with `buildAfinionOru` or `buildAck` in place of editing a string.
The MLLP sender that puts these messages on the wire is
`tests/integration/mllp-sender.ts`.

## Invented data

Nothing here comes from a real analyser, a real patient or the teachers'
material (Q-PRIV-4). The lab numbers have the format of #268: nine digits and
a Damm check digit. The serial numbers are in an `AF99` range, the operator
ID is `SIM001`, and the lots, times, run numbers and values are made up. The
structure follows the protocol's examples; their values are not copied.
