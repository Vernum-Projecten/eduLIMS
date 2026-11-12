#!/usr/bin/env python3
# SPDX-FileCopyrightText: Ruben Talstra
# SPDX-License-Identifier: Apache-2.0
#
# Builds the eduLIMS-lab operational template (OPT 1.4 XML) from the openEHR
# CKM archetypes at the revisions it pins, and writes it to
# docker/ferroehr/definitions/<template id>.opt.
#
#   python3 -I scripts/openehr/build-opt.py            # fetch from CKM, build, write
#   python3 -I scripts/openehr/build-opt.py --check    # fetch, build, diff with the committed file
#   python3 -I scripts/openehr/build-opt.py --sources DIR [--check]
#                                                      # read <archetype id>.xml from DIR instead
#
# Each archetype comes from the CKM REST API as its AOM 1.4 XML
# (GET /ckm/rest/v1/archetypes/{cid}/xml), and the build refuses a file whose
# revision or build_uid differs from the pin below. The OPT copies each
# archetype's definition into a C_ARCHETYPE_ROOT with its English
# term_definitions, fills the slots the template names, closes every other
# slot, and applies the narrowings listed in TEMPLATE. Nothing outside the
# five archetypes enters the template (#146, W4).
#
# A changed template is a new id beside the old one (eduLIMS-lab.v2), because
# FerroEHR stores a template once and never replaces it: add a second TEMPLATE
# entry, never edit one that has shipped (docs/deployment.md, "Templates").
#
# Exit status: 0 ok, 1 a pin or the committed file does not match, 2 a usage
# or network error.

import argparse
import copy
import difflib
import pathlib
import sys
import urllib.request
import xml.etree.ElementTree as ET

O = "http://schemas.openehr.org/v1"
XSI = "http://www.w3.org/2001/XMLSchema-instance"
XSD = "http://www.w3.org/2001/XMLSchema"
NS = {"o": O}
XSI_TYPE = f"{{{XSI}}}type"
CKM = "https://ckm.openehr.org/ckm/rest/v1"
ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "docker" / "ferroehr" / "definitions"

# The CKM archetypes the template is built from: citeable id, revision and
# build_uid, as CKM publishes them.
ARCHETYPES = {
    "openEHR-EHR-COMPOSITION.report-result.v1": ("1013.1.1324", "1.1.0", "8d018ed5-232e-4a45-98e8-00d799383351"),
    "openEHR-EHR-OBSERVATION.laboratory_test_result.v1": ("1013.1.2191", "1.2.8", "f4a7641f-8b09-4a06-b0d8-306eaa56b9af"),
    "openEHR-EHR-CLUSTER.laboratory_test_analyte.v1": ("1013.1.2881", "1.2.3", "b0f08214-c8af-4437-9fdf-7ee6b24f83a1"),
    "openEHR-EHR-CLUSTER.specimen.v1": ("1013.1.331", "1.1.3", "eb43fe33-6b2a-4a8e-acb0-2cf0620ff474"),
    "openEHR-EHR-CLUSTER.device.v1": ("1013.1.17", "1.1.6", "3a525fa5-5061-4864-8368-ad1ea93ac1d4"),
}

UNBOUNDED = None

# The template. Each archetype entry lists, by the archetype's own at-codes:
#   fill        slot -> (filler archetype, occurrences); every other slot closes
#   occurrences node -> (lower, upper)
#   types       ELEMENT -> the value types kept, in order; a type the
#               archetype leaves open ("any") is added
#   codes       ELEMENT -> the local codes its DV_CODED_TEXT keeps
TEMPLATE = {
    "id": "eduLIMS-lab.v1",
    "uid": "c9d683e6-cc7b-4a78-b6aa-21e25deed3aa",
    "concept": "eduLIMS laboratory result",
    "purpose": (
        "Records a measurement of a practical laboratory session in education: the result of one "
        "analyser run on one or more sample IDs, with the analyser, the order (practical) and the "
        "result status."
    ),
    "use": (
        "Written by eduLIMS for the Epoch 2 Excel upload and by FerroBRIDGE for the Afinion 2 HL7 v2 "
        "results. The sample ID is the specimen's laboratory specimen identifier, the well position "
        "its specimen label, the practical the requester order identifier, and the analyser the "
        "medical device."
    ),
    "misuse": (
        "Not for clinical diagnosis or patient care. Never holds a name, student number or e-mail "
        "address in any element."
    ),
    "root": "openEHR-EHR-COMPOSITION.report-result.v1",
    "content": ("openEHR-EHR-OBSERVATION.laboratory_test_result.v1", (1, UNBOUNDED)),
    "archetypes": {
        "openEHR-EHR-COMPOSITION.report-result.v1": {},
        "openEHR-EHR-OBSERVATION.laboratory_test_result.v1": {
            "fill": {
                # Specimen detail
                "at0065": ("openEHR-EHR-CLUSTER.specimen.v1", (1, UNBOUNDED)),
                # Test result
                "at0097": ("openEHR-EHR-CLUSTER.laboratory_test_analyte.v1", (1, UNBOUNDED)),
                # Testing details: the analyser
                "at0110": ("openEHR-EHR-CLUSTER.device.v1", (1, 1)),
            },
            # Requester order identifier: the practical
            "types": {"at0062": ["DV_IDENTIFIER"]},
        },
        "openEHR-EHR-CLUSTER.specimen.v1": {
            # Laboratory specimen identifier: the sample ID
            "occurrences": {"at0001": (1, 1)},
            "types": {"at0001": ["DV_IDENTIFIER"]},
        },
        "openEHR-EHR-CLUSTER.laboratory_test_analyte.v1": {
            # Analyte name, Analyte result, Result status
            "occurrences": {"at0024": (1, 1), "at0001": (1, 1), "at0005": (1, 1)},
            "types": {"at0001": ["DV_QUANTITY"], "at0005": ["DV_CODED_TEXT"]},
            # Preliminary, Final
            "codes": {"at0005": ["at0017", "at0018"]},
        },
        "openEHR-EHR-CLUSTER.device.v1": {},
    },
}


class BuildError(Exception):
    """A pin, a source file or a TEMPLATE entry that the build cannot use."""


def q(tag):
    return f"{{{O}}}{tag}"


def fetch(archetype_id, sources):
    cid, revision, build_uid = ARCHETYPES[archetype_id]
    if sources is not None:
        data = (sources / f"{archetype_id}.xml").read_bytes()
    else:
        request = urllib.request.Request(
            f"{CKM}/archetypes/{cid}/xml",
            headers={"Accept": "application/xml", "User-Agent": "opt-build"},
        )
        with urllib.request.urlopen(request, timeout=120) as response:
            data = response.read()
    archetype = ET.fromstring(data)
    found = archetype.findtext("o:archetype_id/o:value", None, NS)
    details = {d.get("id"): (d.text or "") for d in archetype.findall("o:description/o:other_details", NS)}
    if found != archetype_id:
        raise BuildError(f"{archetype_id}: the source holds {found}")
    if details.get("revision") != revision or details.get("build_uid") != build_uid:
        raise BuildError(
            f"{archetype_id}: revision {details.get('revision')} build_uid {details.get('build_uid')}, "
            f"pinned {revision} {build_uid}"
        )
    return archetype


def interval(tag, lower, upper):
    node = ET.Element(q(tag))
    ET.SubElement(node, q("lower_included")).text = "true"
    if upper is not UNBOUNDED:
        ET.SubElement(node, q("upper_included")).text = "true"
    ET.SubElement(node, q("lower_unbounded")).text = "false"
    ET.SubElement(node, q("upper_unbounded")).text = "true" if upper is UNBOUNDED else "false"
    ET.SubElement(node, q("lower")).text = str(lower)
    if upper is not UNBOUNDED:
        ET.SubElement(node, q("upper")).text = str(upper)
    return node


def set_occurrences(node, bounds):
    old = node.find("o:occurrences", NS)
    new = interval("occurrences", *bounds)
    index = list(node).index(old)
    node.remove(old)
    node.insert(index, new)


def single_attribute(name, lower, upper):
    attribute = ET.Element(q("attributes"), {XSI_TYPE: "C_SINGLE_ATTRIBUTE"})
    ET.SubElement(attribute, q("rm_attribute_name")).text = name
    attribute.append(interval("existence", lower, upper))
    return attribute


def complex_object(rm_type):
    node = ET.Element(q("children"), {XSI_TYPE: "C_COMPLEX_OBJECT"})
    ET.SubElement(node, q("rm_type_name")).text = rm_type
    node.append(interval("occurrences", 1, 1))
    ET.SubElement(node, q("node_id"))
    return node


def nodes_by_code(definition):
    """Maps each at-code of an archetype definition to its node and parent attribute."""
    found = {}

    def walk(node):
        for attribute in node.findall("o:attributes", NS):
            for child in attribute.findall("o:children", NS):
                code = child.findtext("o:node_id", "", NS)
                if code:
                    if code in found:
                        raise BuildError(f"node {code} occurs twice")
                    found[code] = (child, attribute)
                walk(child)

    walk(definition)
    return found


def value_attribute(element):
    for attribute in element.findall("o:attributes", NS):
        if attribute.findtext("o:rm_attribute_name", "", NS) == "value":
            return attribute
    return None


def narrow_types(archetype_id, code, element, keep):
    attribute = value_attribute(element)
    if attribute is None:
        # The archetype leaves the value open ("any"): the template names it.
        attribute = single_attribute("value", 0, 1)
        position = list(element).index(element.find("o:node_id", NS)) + 1
        element.insert(position, attribute)
        for rm_type in keep:
            attribute.append(complex_object(rm_type))
        return
    present = {c.findtext("o:rm_type_name", "", NS): c for c in attribute.findall("o:children", NS)}
    missing = [t for t in keep if t not in present]
    if missing:
        raise BuildError(f"{archetype_id} {code}: the archetype allows no {', '.join(missing)}")
    for rm_type, child in present.items():
        if rm_type not in keep:
            attribute.remove(child)


def narrow_codes(archetype_id, code, element, keep):
    attribute = value_attribute(element)
    phrases = [] if attribute is None else [c for c in attribute.iter(q("children")) if c.get(XSI_TYPE) == "C_CODE_PHRASE"]
    if len(phrases) != 1:
        raise BuildError(f"{archetype_id} {code}: no single coded value to narrow")
    codes = phrases[0].findall("o:code_list", NS)
    present = [c.text for c in codes]
    missing = [c for c in keep if c not in present]
    if missing:
        raise BuildError(f"{archetype_id} {code}: the archetype has no code {', '.join(missing)}")
    for entry in codes:
        if entry.text not in keep:
            phrases[0].remove(entry)


def term_definitions(archetype):
    terms = []
    for language in archetype.findall("o:ontology/o:term_definitions", NS):
        if language.get("language") != "en":
            continue
        for item in language.findall("o:items", NS):
            term = ET.Element(q("term_definitions"), {"code": item.get("code")})
            for entry in sorted(item.findall("o:items", NS), key=lambda e: e.get("id")):
                # An XML parser reads a CR LF in text as LF (XML 1.0, 2.11), so
                # writing LF keeps the meaning and the file stays LF only.
                text = (entry.text or "").replace("\r\n", "\n").replace("\r", "\n")
                ET.SubElement(term, q("items"), {"id": entry.get("id")}).text = text
            terms.append(term)
    if not terms:
        raise BuildError(f"{archetype.findtext('o:archetype_id/o:value', '', NS)}: no English terms")
    return terms


def archetype_root(archetype_id, archetypes, bounds, tag):
    """Returns the C_ARCHETYPE_ROOT of one archetype with its slots filled or closed."""
    archetype = archetypes[archetype_id]
    spec = TEMPLATE["archetypes"][archetype_id]
    root = copy.deepcopy(archetype.find("o:definition", NS))
    root.tag = q(tag)
    if tag == "children":
        root.set(XSI_TYPE, "C_ARCHETYPE_ROOT")
    if bounds is not None:
        set_occurrences(root, bounds)
    nodes = nodes_by_code(root)
    for code, bounds_override in spec.get("occurrences", {}).items():
        set_occurrences(nodes[code][0], bounds_override)
    for code, keep in spec.get("types", {}).items():
        narrow_types(archetype_id, code, nodes[code][0], keep)
    for code, keep in spec.get("codes", {}).items():
        narrow_codes(archetype_id, code, nodes[code][0], keep)
    fill = spec.get("fill", {})
    for code, (node, attribute) in nodes.items():
        if node.get(XSI_TYPE) != "ARCHETYPE_SLOT":
            continue
        index = list(attribute).index(node)
        attribute.remove(node)
        if code in fill:
            filler, filler_bounds = fill[code]
            attribute.insert(index, archetype_root(filler, archetypes, filler_bounds, "children"))
    unknown = set(fill) - {c for c, (n, _) in nodes.items() if n.get(XSI_TYPE) == "ARCHETYPE_SLOT"}
    if unknown:
        raise BuildError(f"{archetype_id}: no slot {', '.join(sorted(unknown))}")
    if archetype_id == TEMPLATE["root"]:
        filler, filler_bounds = TEMPLATE["content"]
        content = ET.Element(q("attributes"), {XSI_TYPE: "C_MULTIPLE_ATTRIBUTE"})
        ET.SubElement(content, q("rm_attribute_name")).text = "content"
        content.append(interval("existence", 0, 1))
        content.append(archetype_root(filler, archetypes, filler_bounds, "children"))
        cardinality = ET.SubElement(content, q("cardinality"))
        ET.SubElement(cardinality, q("is_ordered")).text = "true"
        ET.SubElement(cardinality, q("is_unique")).text = "false"
        cardinality.append(interval("interval", 1, UNBOUNDED))
        root.append(content)
    ET.SubElement(ET.SubElement(root, q("archetype_id")), q("value")).text = archetype_id
    root.extend(term_definitions(archetype))
    return root


def language(parent, tag):
    node = ET.SubElement(parent, q(tag))
    ET.SubElement(ET.SubElement(node, q("terminology_id")), q("value")).text = "ISO_639-1"
    ET.SubElement(node, q("code_string")).text = "en"


def build(sources):
    archetypes = {archetype_id: fetch(archetype_id, sources) for archetype_id in ARCHETYPES}
    template = ET.Element(q("template"))
    language(template, "language")
    description = ET.SubElement(template, q("description"))
    ET.SubElement(description, q("original_author"), {"id": "organisation"}).text = "eduLIMS"
    ET.SubElement(description, q("lifecycle_state")).text = "unmanaged"
    sources_line = "; ".join(f"{a} {r} (CKM {c})" for a, (c, r, _) in ARCHETYPES.items())
    ET.SubElement(description, q("other_details"), {"id": "archetypes"}).text = sources_line
    ET.SubElement(description, q("other_details"), {"id": "licence"}).text = (
        "Built from openEHR CKM archetypes, copyright openEHR Foundation, licensed under the Creative "
        "Commons Attribution-ShareAlike 4.0 International License "
        "(https://creativecommons.org/licenses/by-sa/4.0/); this template is shared under the same licence."
    )
    details = ET.SubElement(description, q("details"))
    language(details, "language")
    for field in ("purpose", "use", "misuse"):
        ET.SubElement(details, q(field)).text = TEMPLATE[field]
    ET.SubElement(ET.SubElement(template, q("uid")), q("value")).text = TEMPLATE["uid"]
    ET.SubElement(ET.SubElement(template, q("template_id")), q("value")).text = TEMPLATE["id"]
    ET.SubElement(template, q("concept")).text = TEMPLATE["concept"]
    template.append(archetype_root(TEMPLATE["root"], archetypes, None, "definition"))
    ET.indent(template, space="  ")
    ET.register_namespace("", O)
    ET.register_namespace("xsi", XSI)
    body = ET.tostring(template, encoding="unicode", short_empty_elements=True)
    # `xsd:string` appears in attribute values only (EXPR_LEAF items), so
    # ElementTree does not declare the prefix by itself.
    body = body.replace(f'<template xmlns="{O}"', f'<template xmlns="{O}" xmlns:xsd="{XSD}"', 1)
    return f'<?xml version="1.0" encoding="UTF-8"?>\n{body}\n'


def main():
    parser = argparse.ArgumentParser(description="Builds the eduLIMS-lab operational template.")
    parser.add_argument("--check", action="store_true", help="diff with the committed file, write nothing")
    parser.add_argument("--sources", type=pathlib.Path, help="read <archetype id>.xml from this directory")
    args = parser.parse_args()
    target = OUT_DIR / f"{TEMPLATE['id']}.opt"
    try:
        text = build(args.sources)
    except BuildError as error:
        print(f"build-opt: {error}", file=sys.stderr)
        return 1
    except OSError as error:
        print(f"build-opt: {error}", file=sys.stderr)
        return 2
    if args.check:
        committed = target.read_text(encoding="utf-8") if target.exists() else ""
        if committed == text:
            print(f"build-opt: {target.relative_to(ROOT)} matches the CKM archetypes")
            return 0
        diff = difflib.unified_diff(committed.splitlines(), text.splitlines(), "committed", "built", lineterm="")
        print("\n".join(list(diff)[:40]))
        print(f"build-opt: {target.relative_to(ROOT)} differs from the build", file=sys.stderr)
        return 1
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")
    print(f"build-opt: wrote {target.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
