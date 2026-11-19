<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Gen5 export fixtures

Excel exports of the BioTek Epoch 2 from Gen5, for the upload tests (S4). The
layout they follow is the contract in `docs/gen5-export.md`.

## Good files

| File | What it is |
|---|---|
| `epoch2-endpoint-750nm-air.xlsx` | A real export a teacher supplied on 2026-11-19: one sheet, the header block and a 96-well grid (rows A to H, columns 1 to 12) of an absorbance endpoint read at 750 nm of an empty plate, so every value is the absorbance of air. Gen5 3.11.19, reader type Epoch 2. |
| `epoch2-endpoint-450nm-gradient.xlsx` | An invented plate in the same layout: a 450 nm read whose absorbance rises from 0.05 in A1 to 2.13 in H12, so calculation work has values across a realistic range. Built by `xlsx-builder.ts`; the entries are stored, not deflated, so the bytes are the same on every Node runtime. |

The owner cleared the first file for the repository on 2026-11-19, because it
holds no sample and no result of a simulation. Three values that named a
person or an institution were replaced before it was committed, and nothing
else was changed: the author and last editor in the document properties, the
user folder in the experiment file path of the header, and the saved location
in the workbook.

No other file from the teachers belongs here (Q-PRIV-4). Every further
fixture is made from scratch with invented values.

To write the invented good file again after a change to the builder, run
`node tests/fixtures/gen5/generate.ts`. A unit test fails when the committed
bytes and the builder's output differ.

## Bad files

The bad files are built in memory by `bad-files.ts`, one per rule of the
contract, each with the first error the parser must return. They are not
committed as binaries, because each differs from a good file in one cell or
one header field, and the code shows that difference where a binary would
hide it.

| Rule | Built from |
|---|---|
| Over the upload limit (1 MiB) | 1 MiB and one byte of zeros |
| Not `.xlsx` | a good workbook named `plate.xls` |
| Not a zip | a CSV named `plate.xlsx` |
| A zip that is no workbook | a zip with one text file |
| A macro-enabled workbook | a good workbook with the macro-enabled content type |
| Over the entry limit (50) | a good workbook with 50 more entries |
| Over the unpacked limit (8 MiB) | a good workbook with an 8 MiB entry of zeros |
| A zip bomb | the sheet replaced by 64 MiB of zeros that declares 4 KiB |
| A DTD with an external entity | the sheet replaced by an XXE document |
| Two sheets (a second plate) | a good workbook with the sheet twice |
| No grid | a good sheet without rows 24 to 32 |
| A grid that is not 8 by 12 | a 13th column, a 9th row, or only 7 rows |
| An empty well | a good sheet without the value in C3 |
| A value that is not a number | `OVRFLW` in H12 |
| Two wavelengths | `Wavelengths:  450, 750` |
| A kinetic read | `Absorbance Kinetic` |
| Another plate type | `384 WELL PLATE` |

`tests/unit/gen5-parser.test.ts` runs every file, and checks each limit at and
one over its boundary.
