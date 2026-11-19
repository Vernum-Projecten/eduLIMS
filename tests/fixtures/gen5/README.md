<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Gen5 export fixtures

Excel exports of the BioTek Epoch 2 from Gen5, for the upload tests (S4).

| File | What it is |
|---|---|
| `epoch2-endpoint-750nm-air.xlsx` | A real export a teacher supplied on 2026-11-19: one sheet, the header block and a 96-well grid (rows A to H, columns 1 to 12) of an absorbance endpoint read at 750 nm of an empty plate, so every value is the absorbance of air. Gen5 3.11.19, reader type Epoch 2. |

The owner cleared this file for the repository on 2026-11-19, because it holds
no sample and no result of a simulation. Three values that named a person or
an institution were replaced before it was committed, and nothing else was
changed: the author and last editor in the document properties, the user
folder in the experiment file path of the header, and the saved location in
the workbook. Only the three parts that held them were compressed again; every
other part, its compressed bytes, and every header field of the archive (the
flags, the times, the order of the entries) are what Excel wrote.

No other file from the teachers belongs here (Q-PRIV-4). Every further
fixture is made from scratch with invented values.
