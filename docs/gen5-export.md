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
points and the limits below on 2026-11-19 (#153, #154, and the security review
of #297).

## The file (ASVS 5.0 V5.1.1)

| Point | Contract |
|---|---|
| File type | An Office Open XML workbook (ECMA-376), as Gen5 3.11 writes it when it exports a plate to Excel |
| Extension | `.xlsx`, compared without regard to case; `.xls`, `.xlsm`, `.csv` and the rest are refused |
| Content | A zip archive (it starts with `PK\x03\x04`) whose `[Content_Types].xml` gives the workbook part the type `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml`; a macro-enabled workbook or a template has another type and is refused |
| Maximum file size | 1 MiB (1,048,576 bytes), checked before anything else is read |
| Maximum unpacked size | 8 MiB (8,388,608 bytes): the sum of the sizes the archive declares for its entries, checked before any entry is unpacked |
| Maximum unpacked size of one part | 1 MiB (1,048,576 bytes) for each part the reader opens, checked from the declared size before it is unpacked and enforced while it is unpacked |
| Maximum entries | 50 entries in the archive, checked before any entry is unpacked |
| XML caps, per part | at most 5,000 elements, nesting at most 32 deep (the root is at depth 1), at most 32 attributes on one element, and at most 64 namespace declarations (`xmlns`, `xmlns:p`) in the part; each is enforced while the part is read, so reading stops at the first element or declaration over a cap |
| Sheets | Exactly one |

The supplied export is 9,593 bytes with 13 entries and 38,586 bytes unpacked;
its largest part, the sheet, is 9,222 bytes with 352 elements, and no part declares more than 11 namespaces. The
limits leave room for any one-plate export and stop a crafted file early. The
constants are in `src/server/upload/limits.ts`; no environment variable
changes them.

### How the archive is read

The parser reads the archive in memory and writes nothing to disk. It never
uses the uploaded file name, or a name inside the archive, as a path (ASVS 5.0
V5.3.2): the file name is read for its extension only, and entry names are
lookup keys.

It reads the central directory first and refuses ZIP64, a split archive,
encryption, a compression method other than stored or deflate, duplicate entry
names, and bytes after the end record. When a comment holds a second end
record, the last one is read, and the file is refused unless a central
directory ends at it. It then checks every local header against its directory
entry: the name, the method and the flags must agree, and the sizes and the
CRC-32 must agree unless the data-descriptor flag is set and the local values
are zero. Entries must not overlap, and every entry's data must end before
the central directory.

It unpacks only the six parts it needs: `[Content_Types].xml`, the package
relationships (`_rels/.rels`), the workbook, the workbook relationships, the
shared strings and the sheet. Styles, theme, printer settings and document
properties are never unpacked or inspected. That holds only while the
original file is neither stored nor served; an upload that keeps the file
needs its own check of those entries. Each unpacked part must match the size
and the CRC-32 its directory entry declares; inflation stops as soon as the
output passes the declared size, so an entry that claims a small size cannot
expand without bound (V5.2.3).

The XML parts must be UTF-8, with or without a byte order mark; a part in
UTF-16 is refused. Every raw character must be one the XML 1.0 Char
production allows (§2.2), so NUL, the C0 controls other than tab, line feed
and carriage return, U+FFFE, U+FFFF and lone surrogates are refused. A
document type declaration is refused outright, so no entity can be declared,
expanded or fetched (V1.5.1); only the five predefined entities and character
references are read. Elements are matched by their namespace and local name:
the SpreadsheetML main namespace for the workbook, the sheet and the shared
strings, and the package namespaces for the content types and the
relationships. An element in another namespace is not read. An element keeps only its own
namespace declarations, and a prefix is resolved by walking up to the root, which the depth
cap bounds; no scope is copied per element.

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
| A2 | `Software Version` | B2, text of digits and dots, 1 to 32 characters | reads it as `softwareVersion` |
| A4 | `Experiment File Path:` | B4 | never reads the value: the path can name a user account (Q-PRIV-4) |
| A5 | `Protocol File Path:` | B5 | never reads the value |
| A6 | `Plate Number` | B6 | never reads the value: a user types it in Gen5 |
| A7 | `Date` | B7, a whole-number date serial | reads it as `date`, `YYYY-MM-DD` |
| A8 | `Time` | B8, a fraction of a day | reads it as `time`, `HH:MM:SS`, rounded to the second |
| A9 | `Reader Type:` | B9, printable ASCII text, 1 to 64 characters | reads it as `readerType` |
| A10 | `Reader Serial Number:` | B10, ASCII letters and digits, 1 to 32 characters, or a whole number | reads it as `readerSerialNumber` |
| A11 | `Reading Type` | B11 | never reads the value |
| A13 | `Procedure Details` | | |
| A14 | `Plate Type` | B14 | requires `96 WELL PLATE` |
| A15 | `Eject plate on completion` | | |
| A16 | `Read` | B16 | requires `Absorbance Endpoint` |
| | | B17 | requires `Full Plate` |
| | | B18 | requires `Wavelengths:` and one whole number of nanometres, read as `wavelengthNm` |
| | | B19 | never reads the value (the read speed line) |
| A21 | `Results` | | |
| A22 | `Actual Temperature:` | B22, a number | reads it as `temperatureCelsius` |

A header value in another form, a control character or a bidirectional
override included, is refused with `header_invalid` and its cell.

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

A well holds a numeric cell. The file writes the value as decimal text, such
as `4.2000000000000003E-2`. The parser returns it in two forms that hold the
same number: `value`, the IEEE 754 double nearest to that text, and `text`, the
shortest plain decimal that reads back to exactly that double (`0.042`).

What is guaranteed: when the text has at most 17 significant digits, as every
value Excel writes from a double does, `value` is the double the workbook
stored, and `Number(text) === value` holds. The parser refuses, and never
rounds silently, a text with more than 17 significant digits (leading and
trailing zeros are not counted) and a text that is not zero but would read as
zero, such as `1e-400`. A negative value and zero are numbers; `-0` is read as
`0`.

A well that is empty, holds text (such as an overflow mark), a formula, an
error value or a boolean is refused, and so is a value that is not a finite
number.

## What is refused

Each refusal is a typed error (`src/server/upload/errors.ts`) that names the
item in error, so the message can name it and suggest a fix (WCAG 2.1 SC 3.3.1
and 3.3.3). A file or archive error ends the parse at once; the layout errors
of the sheet are returned together.

An error carries no text from the file beyond what it needs (ASVS 5.0
V16.5.1). An error about an arbitrary archive entry names no entry. A `part`
names a part the reader asked for, cut to 128 characters, because a
relationship target in the file chooses that name. A layout error names a cell
by its reference and carries no cell text.

| Rule | Error |
|---|---|
| Over 1 MiB | `file_too_large` |
| Not `.xlsx` | `wrong_extension` |
| Not a zip | `not_a_zip` |
| More than 50 entries | `too_many_entries` |
| More than 8 MiB unpacked in total | `unpacked_too_large` |
| A part over 1 MiB unpacked | `part_too_large`, with the part |
| An entry larger or smaller than it declares | `entry_size_mismatch`, with the part when the reader asked for it |
| ZIP64, split, encrypted, another compression | `archive_unsupported`, with the reason |
| A broken zip structure, overlapping entries, a local header that disagrees, a bad checksum | `archive_corrupt`, with the reason |
| A missing workbook part or the wrong content type | `not_a_workbook`, with the part |
| XML that is not well formed or holds a character XML forbids | `xml_malformed`, with the part |
| A DTD in any part | `xml_dtd_refused`, with the part |
| A part over an XML cap | `xml_too_large`, with the part and the cap (`elements`, `depth`, `attributes` or `namespaces`) |
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

## The check of the plate and the links

After the parse, `checkPlateLinks` in `src/server/upload/plate-links.ts`
checks the plate and the team's links from wells to samples for one lab
(S4, S10, R-06; #155). It is a pure function: the caller loads the lab's
samples in its own transaction, filtered by the lab in the SQL query, and
passes them in. A sample of another lab in that list, or two samples with
one lab number, is a defect of the caller and throws.

A link names a well and a sample by its lab number. The sample number from
the form is never the key: every team works the same sample numbers (R-11),
and one lab may record a sample number twice for a second tube (S12). The
lab number is unique across the teams of every simulation, so a link can
match only a sample of the uploader's own lab.

The plate it takes holds exactly one value for each of the 96 wells, in
reading order. Its type says so: `PlateWells` is a branded type that only
`toPlateWells` in `src/server/upload/gen5-layout.ts` makes, and the parser
calls it after its 8 by 12 check. An empty well is refused by the parser
(`well_empty`), and a plate with a well missing or twice cannot reach the
check. The brand is the defence in depth behind the parser for an empty or
a doubled value, so the check has no `value_empty` or `value_duplicate`
refusal: a check the type makes unreachable could be tested only through a
cast that lies.

The maintainer decided two points on #372: a link names the sample by its
lab number, the one key unique across every simulation and the number the
Afinion route uses; and an absorbance keeps at most 6 decimals, the bound of
the tolerance check, since Gen5 reports fewer.

| Rule | Refusal |
|---|---|
| More than 96 links | `links_too_many`, with the count and the limit, and nothing else is checked |
| A value with more than 9 digits before the point | `value_out_of_bounds`, with the well |
| A value within that size with more than 6 decimals (`0.30000000000000004`) | `value_too_precise`, with the well |
| A link to a position outside A1 to H12 (`A13`, `I1`, `A01`) | `well_outside_plate`, with the position as sent (cut to 128 characters) and the index of the link |
| A well linked more than once | `link_duplicate`, with the well, once |
| A link without a lab number | `lab_number_missing`, with the well |
| A lab number that fails the format or the check digit | `lab_number_invalid`, with the well |
| A lab number of no sample of the lab, another lab's included | `sample_unknown`, with the well |

Every refusal is returned together: the plate's in reading order, then the
links' in the order sent. Several wells may hold one sample (replicates), and
a well without a link stays unlinked. On success each of the 96 wells carries
its absorbance as an exact decimal in the bounds the tolerance check reads,
and its linked sample or none. The values of the supplied export all fall
inside those bounds.

## The fixtures and the mutation test

`tests/fixtures/gen5/README.md` lists the good files and the bad file for each
rule. Apart from the supplied export of an empty plate, every fixture is
invented (Q-PRIV-4).

`tests/unit/gen5-mutation.test.ts` makes 4,500 seeded mutants of the two good
files (bytes of the container, and bytes of the XML parts packed again) and
checks that each gives a typed refusal or a valid plate, never an exception,
within a time budget.
