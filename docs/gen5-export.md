<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# The Gen5 export contract

This page pins the one file layout the Epoch 2 upload accepts (S4). It is
taken cell by cell from the export a teacher supplied on 2026-11-19, which is
committed as `tests/fixtures/gen5/epoch2-endpoint-750nm-air.xlsx` (#153). The
parser in `src/server/upload/` accepts exactly this layout and nothing looser
(risk P-03: "the parser validates strictly", #154). A file in another layout
is refused whole, and nothing from it is kept.

The plate is 96-well only, and a file holds one plate, one sheet and one
wavelength of one absorbance endpoint read. The maintainer decided these
points and the limits below on 2026-11-19 (#153, #154).

## The file (ASVS 5.0 V5.1.1)

| Point | Contract |
|---|---|
| File type | An Office Open XML workbook (ECMA-376), as Gen5 3.11 writes it when it exports a plate to Excel |
| Extension | `.xlsx`, compared without regard to case; `.xls`, `.xlsm`, `.csv` and the rest are refused |
| Content | A zip archive (it starts with `PK\x03\x04`) whose `[Content_Types].xml` gives the workbook part the type `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml`; a macro-enabled workbook or a template has another type and is refused |
| Maximum file size | 1 MiB (1,048,576 bytes), checked before anything else is read |
| Maximum unpacked size | 8 MiB (8,388,608 bytes): the sum of the sizes the archive declares for its entries, checked before any entry is unpacked |
| Maximum entries | 50 entries in the archive, checked before any entry is unpacked |
| Sheets | Exactly one |

The supplied export is 9,593 bytes with 13 entries and 38,586 bytes unpacked, so
the limits leave room for any one-plate export and stop a crafted file early.
The constants are in `src/server/upload/limits.ts`; no environment variable
changes them.

### How the archive is read

The parser reads the archive in memory and writes nothing to disk. It never
uses the uploaded file name, or a name inside the archive, as a path (ASVS 5.0
V5.3.2): the file name is read for its extension only, and entry names are
lookup keys.

It reads the central directory first and refuses ZIP64, a split archive,
encryption, a compression method other than stored or deflate, duplicate entry
names, and bytes after the end record. It then unpacks only the five parts it
needs: `[Content_Types].xml`, the package and workbook relationships, the
workbook, the shared strings and the sheet. Styles, theme, printer settings
and document properties are never unpacked. Each unpacked part must match the
size and the CRC-32 its directory entry declares; inflation stops as soon as
the output passes the declared size, so an entry that claims a small size
cannot expand without bound (V5.2.3).

The XML parts must be UTF-8 and well formed. A document type declaration is
refused outright, so no entity can be declared, expanded or fetched (V1.5.1);
only the five predefined entities and character references are read.

The supplied fixture was rewritten by a zip tool when it was cleaned, so its
container flags are not necessarily the ones Gen5 writes. The container checks
follow the zip format (PKWARE APPNOTE 6.3.10), not that one file: a data
descriptor flag, for example, is accepted.

## The sheet

The sheet has two blocks: the header block in columns A and B, rows 2 to 22,
and the grid in rows 24 to 32. Every label must stand in its cell with exactly
the text below; any cell outside the layout that holds a value is refused. A
cell that holds only formatting counts as empty.

### The header block

| Cell | Label | Value cell | The parser |
|---|---|---|---|
| A2 | `Software Version` | B2, text | reads it as `softwareVersion` |
| A4 | `Experiment File Path:` | B4 | ignores the value: the path can name a user account (Q-PRIV-4) |
| A5 | `Protocol File Path:` | B5 | ignores the value |
| A6 | `Plate Number` | B6, text | reads it as `plateNumber` |
| A7 | `Date` | B7, a whole-number date serial | reads it as `date`, `YYYY-MM-DD` |
| A8 | `Time` | B8, a fraction of a day | reads it as `time`, `HH:MM:SS`, rounded to the second |
| A9 | `Reader Type:` | B9, text | reads it as `readerType` |
| A10 | `Reader Serial Number:` | B10, text or a whole number | reads it as `readerSerialNumber` |
| A11 | `Reading Type` | B11 | ignores the value |
| A13 | `Procedure Details` | | |
| A14 | `Plate Type` | B14 | requires `96 WELL PLATE` |
| A15 | `Eject plate on completion` | | |
| A16 | `Read` | B16 | requires `Absorbance Endpoint` |
| | | B17 | requires `Full Plate` |
| | | B18 | requires `Wavelengths:` and one whole number of nanometres, read as `wavelengthNm` |
| | | B19 | ignores the value (the read speed line) |
| A21 | `Results` | | |
| A22 | `Actual Temperature:` | B22, a number | reads it as `temperatureCelsius` |

The date and the time are the local date and time of the reader's computer, as
the file gives them; the file holds no time zone, so the parser adds none. The
date serial counts days in the workbook's date system: the 1900 system, which
Gen5 writes, or the 1904 system when the workbook says so. A 1900 serial before
61 (1 March 1900) is refused, because those serials carry the spreadsheet
leap-year error.

### The grid

| Cells | Content |
|---|---|
| C24 to N24 | The column numbers 1 to 12, as numbers |
| B25 to B32 | The row letters `A` to `H` |
| C25 to N32 | The 96 absorbance values: row A in row 25, column 1 in column C |
| O25 to O32 | The wavelength of the header, repeated at the end of every row |

### The values

A well holds a numeric cell. Its value is the IEEE 754 double the workbook
stores, written in the file in its exact form (`4.2000000000000003E-2`). The
parser returns each value in two forms that hold the same number: `value`,
that double, and `text`, the shortest plain decimal that reads back to exactly
that double (`0.042`). Nothing is rounded and nothing is lost. A negative
value and zero are numbers; `-0` is read as `0`.

A well that is empty, holds text (such as an overflow mark), a formula, an
error value or a boolean is refused, and so is a value that is not a finite
number.

## What is refused

Each refusal is a typed error (`src/server/upload/errors.ts`) that names the
item in error, so the message can name it and suggest a fix (WCAG 2.1 SC 3.3.1
and 3.3.3). A file or archive error ends the parse at once; the layout errors
of the sheet are returned together.

| Rule | Error |
|---|---|
| Over 1 MiB | `file_too_large` |
| Not `.xlsx` | `wrong_extension` |
| Not a zip | `not_a_zip` |
| More than 50 entries | `too_many_entries` |
| More than 8 MiB unpacked | `unpacked_too_large` |
| An entry larger or smaller than it declares | `entry_size_mismatch`, with the entry |
| ZIP64, split, encrypted, another compression | `archive_unsupported`, with the reason |
| A broken zip structure or checksum | `archive_corrupt`, with the reason |
| A missing workbook part or the wrong content type | `not_a_workbook`, with the part |
| XML that is not well formed | `xml_malformed`, with the part |
| A DTD in any part | `xml_dtd_refused`, with the part |
| No sheet, or more than one (a second plate) | `sheet_count` |
| A label missing or changed | `label_missing`, with the cell |
| A header value missing or in the wrong form | `header_missing` or `header_invalid`, with the field and the cell |
| Another plate type | `plate_type_unsupported` |
| Another read type (kinetic, fluorescence) | `read_type_unsupported` |
| A partial plate read | `read_area_unsupported` |
| More than one wavelength | `wavelength_count` |
| No grid | `grid_missing` |
| A grid that is not 8 by 12, or a label out of place | `grid_shape`, with the first cell |
| An empty well | `well_empty`, with the well and the cell |
| A well that is not a number | `well_not_a_number`, with the well and the cell |
| A repeated wavelength that differs | `wavelength_mismatch`, with the cell |
| Any other cell with a value | `unexpected_content`, with the first cell |

A second plate gives a second sheet or a second grid and is refused. A second
wavelength changes the wavelength line and is refused.

## What the file does not hold

The export holds no sample number, no plate layout and no concentration. The
team says which well holds which sample, and the concentration is calculated
by the team or by eduLIMS, as the teacher chose for the test (S4, D9; see
[The LIMS workflow](lims-workflow.md#a-measurement-on-the-epoch-2)).

## The fixtures

`tests/fixtures/gen5/README.md` lists the good files and the bad file for each
rule. Apart from the supplied export of an empty plate, every fixture is
invented (Q-PRIV-4).
