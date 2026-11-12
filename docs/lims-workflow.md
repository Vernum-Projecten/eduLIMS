<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# The LIMS workflow

This page shows how a measurement travels through eduLIMS, from the patient a
student registers to the lab report the teacher grades. Students practise the
workflow of a real laboratory, so eduLIMS follows the chain a real LIMS
follows. The diagrams are the reference for building v0.3.0 (#132 to #185) and
for setting up the analysers.

Status: the chain and the fictional patients are the maintainer's decision of
2026-11-12, to be confirmed by the product owner and the privacy officer
(#131, X1). Points still open are marked **Open** with their issue.

## The chain

A real LIMS runs patient, order, specimen, result, validation and report.
eduLIMS runs the same chain. The teacher decides per practical which of the
optional steps (dashed) are on.

```mermaid
flowchart LR
    P[Patient<br/>fictional, under a pseudonym] --> O[Order<br/>the tests requested]
    O --> S[Specimen<br/>with its sample ID]
    S --> M[Measurement<br/>Afinion 2 or Epoch 2]
    M --> R[Result<br/>Preliminary]
    R --> V[Validation<br/>the student releases it: Final]
    V --> L[Lab report<br/>handed in before the deadline]
    L --> G[Assessment<br/>rubric and grade]

    classDef optional stroke-dasharray: 5 5
    class O,V optional
```

| Step | What happens | Who |
|---|---|---|
| Patient | A fictional patient: the case details the practical needs. The teacher provides the patients, or the students register them. | teacher or student |
| Order | The tests requested for that patient within the practical (for example HbA1c and CRP on the Afinion 2). Optional: without it, a specimen hangs directly under the patient. | student |
| Specimen | eduLIMS generates the sample ID for the specimen. The ID is unique and has a check character, so a typing mistake is caught. | eduLIMS |
| Measurement | The student measures the specimen on the analyser. | student |
| Result | The result reaches FerroEHR and shows in eduLIMS as Preliminary. | analyser, FerroBRIDGE, eduLIMS |
| Validation | The student checks the result and releases it as Final. Optional: without it, results are Final on arrival. | student |
| Lab report | The student hands in the report with the released results; it locks on submission and after the deadline (S6). | student |
| Assessment | The teacher grades it with the rubric (D4). | teacher |

## Who owns what, and where it lives

The work belongs to the student or the lab group who placed the order. Every
specimen and result hangs under that order, and every server function checks
that ownership in its database query, so no student can see, take or submit
another student's results (S7).

```mermaid
erDiagram
    PRACTICAL ||--o{ PATIENT : "provides or allows"
    PRACTICAL ||--o{ ORDER : "holds"
    STUDENT_OR_GROUP ||--o{ ORDER : "places and owns"
    PATIENT ||--o{ ORDER : "is ordered for"
    ORDER ||--o{ SPECIMEN : "is taken as"
    SPECIMEN ||--o{ RESULT : "is measured as"
    STUDENT_OR_GROUP ||--o{ LAB_REPORT : "hands in"
    LAB_REPORT }o--o{ RESULT : "uses released"
```

| Data | Lives in | Holds no |
|---|---|---|
| Practicals, patients (fictional details), orders, specimens and sample IDs, ownership, lab reports, grades | the eduLIMS database | measurement values |
| Each result as an openEHR composition on the `eduLIMS-lab` template, in the EHR of the patient's pseudonym, with the sample ID, the analyte, the value, the device and the time | FerroEHR | name, student number or email address (Q-PRIV-1) |

eduLIMS keeps no copy of a measurement: it reads results from FerroEHR with
AQL when a screen needs them, and stores the composition id (decided on #131,
X4).

## Configuration per practical

The teacher sets these when creating the practical (#132 to #135). The list
is a proposal for v0.3.0; the requirement it serves is D1.

| Setting | Choices | Default (proposal) |
|---|---|---|
| Patients | given by the teacher, or registered by the students | given by the teacher |
| Order step | on or off | on |
| Validation step | on or off | on |
| Work | individual or per lab group (#136) | individual |
| Analysers | Afinion 2, Epoch 2 or both | per practical |

## A measurement on the Afinion 2

The Afinion 2 sends each result itself over the lab network as HL7 v2.4 to
FerroBRIDGE, which writes it to FerroEHR. The student enters two identifiers
on the analyser: the analyser offers up to four patient ID fields and an
operator ID of up to 16 characters each (Afinion 2 User Manual, 1117346 Rev. A,
2023/02, "Patient ID" and "Operator ID", vendored in `docs/vendor/afinion/`).

```mermaid
sequenceDiagram
    actor S as Student
    participant E as eduLIMS
    participant A as Afinion 2
    participant B as FerroBRIDGE
    participant F as FerroEHR

    S->>E: register or pick the patient, place the order
    E-->>S: sample ID for the specimen
    S->>A: operator ID, patient ID and sample ID, then the cartridge
    A->>B: HL7 v2.4 ORU^R01 over MLLP
    B->>B: check the sender: address, facility, device serial (#210)
    B->>F: composition on eduLIMS-lab, status Preliminary
    B-->>A: acknowledgement (AA, or AE or AR with the reason)
    E->>F: AQL: results of this sample ID
    F-->>E: the composition
    E-->>S: the result under the order, Preliminary
    S->>E: check and release (when validation is on)
    E->>F: status Final
```

- **Open, X3 on #131 and #209:** which HL7 fields carry the patient pseudonym
  and the sample ID. The manual says the entered ID goes out as "HIS Patient
  ID" or "Visit Number" (Table 2, "Patient ID As"); the exact segments are in
  Abbott's HL7 data sheet, which is not vendored yet.
- **Open, FerroHEALTH/FerroBRIDGE#1918:** the Afinion 2 has no TLS, and
  FerroBRIDGE 0.0.24 accepts MLLP only over TLS. The route waits on the
  address-bound plain lane for devices.
- **Open:** how eduLIMS learns about a new result within the minute of S5:
  FerroEHR's change feed, or a short query interval.
- A result whose sample ID eduLIMS does not know is never attached to a
  sample: it is logged and shown to administrators (#163).

## A measurement on the Epoch 2

The Epoch 2 has no network route here. The student exports the plate from
Gen5 and uploads the Excel file; eduLIMS checks it and writes the results to
FerroEHR over openEHR REST.

```mermaid
sequenceDiagram
    actor S as Student
    participant E as eduLIMS
    participant F as FerroEHR

    S->>E: register or pick the patients, place the orders
    E-->>S: a sample ID per specimen
    Note over S: measure the plate, export it from Gen5
    S->>E: upload the Gen5 export
    E->>E: check sample IDs, wells, empty and duplicate values (S4)
    alt a check fails
        E-->>S: refused, with the row and the reason
    else every check passes
        E->>F: compositions on eduLIMS-lab, status Preliminary
        E-->>S: the results under their orders
    end
```

- **Open, #131:** the Gen5 version, the export layout and the assays per
  practical.

## The states of a result

```mermaid
stateDiagram-v2
    [*] --> Preliminary: arrives from the analyser or the upload
    Preliminary --> Final: the student releases it
    Preliminary --> Final: on arrival, when validation is off
    Final --> [*]: used in the lab report
    [*] --> Unmatched: unknown sample ID
    Unmatched --> [*]: an administrator resolves it
```

## Setting up an Afinion 2

| Who | Where | What |
|---|---|---|
| The institution's IT | the lab network | a fixed address per Afinion 2; only those addresses reach the MLLP port of the eduLIMS server ([The MLLP port](deployment.md#the-mllp-port)) |
| The administrator | eduLIMS, Admin, Analysers and integrations | register each analyser: model, serial number, location |
| The operator of the server | `ferrobridge.toml` and the host firewall | one sender per analyser (facility, address, device), and the allow-list |
| The lab supervisor | the analyser, General settings, Connectivity settings | protocol HL7; server IP and port; receiving application and facility; Patient ID on; Operator ID on, optionally with verification against the analyser's operator list |

## Related

- [Architecture](architecture.md): the portals, the data split and the
  integrations.
- [Requirements](requirements.md): S3 to S7 and D1 to D4.
- [ADR 0013](adr/0013-internal-transport-security.md): the MLLP transport.
- #131: the decisions this page waits on.
