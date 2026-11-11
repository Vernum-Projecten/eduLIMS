#!/usr/bin/env bash
# SPDX-FileCopyrightText: Ruben Talstra
# SPDX-License-Identifier: Apache-2.0
#
# Sets the release version everywhere the repository records it:
# package.json `version`; CITATION.cff `version` and `date-released` (added
# on the first cut); and .zenodo.json `version`, `publication_date` and the
# isSupplementTo link to the tag's tree, which Zenodo shows as the record's
# GitHub link. scripts/checks/citation.sh holds the three files to each other.
#
#   scripts/release/version.sh <version> [<date>]   # write; date defaults to today (UTC)
#   scripts/release/version.sh --check <version>    # exit 1 unless every place holds it
#   scripts/release/version.sh --self-test
#
# <version> is SemVer without the leading "v": 0.1.0, or 0.1.0-rc.1.
set -euo pipefail
export LC_ALL=C

die() {
  echo "version: $*" >&2
  exit 1
}

usage() {
  echo "usage: version.sh <version> [<date>] | --check <version> | --self-test" >&2
  exit 2
}

valid() {
  [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || die "'$1' is not a version such as 0.1.0 or 0.1.0-rc.1"
}

write() {
  local version="$1" date="$2"
  valid "$version"
  [[ "$date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || die "'$date' is not a date written YYYY-MM-DD"
  [[ -f package.json ]] || die "package.json is missing"
  # node keeps the key order and writes the two-space indent Biome expects.
  VERSION="$version" node -e '
    const fs = require("node:fs");
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    pkg.version = process.env.VERSION;
    fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
  '
  echo "version: package.json is at ${version}."
  if [[ -f CITATION.cff ]]; then
    grep -qE '^version:' CITATION.cff || die "CITATION.cff has no top-level version key"
    local tmp
    tmp="$(mktemp)"
    awk -v v="$version" -v d="$date" '
      /^version:/ { print "version: \"" v "\""; if (!dated) print "date-released: \"" d "\""; dated = 1; next }
      /^date-released:/ { if (!dated) print "date-released: \"" d "\""; dated = 1; next }
      { print }
    ' CITATION.cff > "$tmp"
    cat "$tmp" > CITATION.cff
    rm -f -- "$tmp"
    echo "version: CITATION.cff is at ${version}, released ${date}."
  fi
  if [[ -f .zenodo.json ]]; then
    local repo
    repo="$(sed -nE 's/^repository-code:[[:space:]]*"?([^"]*)"?[[:space:]]*$/\1/p' CITATION.cff 2>/dev/null || true)"
    [[ -n "$repo" ]] || die ".zenodo.json needs CITATION.cff repository-code for the tag link"
    # publication_date goes after the description, the tag link after isDocumentedBy.
    VERSION="$version" DATE="$date" TREE="${repo}/tree/v${version}" node -e '
      const fs = require("node:fs");
      const z = JSON.parse(fs.readFileSync(".zenodo.json", "utf8"));
      const out = {};
      for (const [key, value] of Object.entries(z)) {
        if (key === "publication_date") continue;
        out[key] = key === "version" ? process.env.VERSION : value;
        if (key === "description") out.publication_date = process.env.DATE;
      }
      if (!("publication_date" in out)) out.publication_date = process.env.DATE;
      const link = { identifier: process.env.TREE, relation: "isSupplementTo", resource_type: "software" };
      const rel = (out.related_identifiers ?? []).filter((r) => r.relation !== "isSupplementTo");
      rel.splice(rel.findIndex((r) => r.relation === "isDocumentedBy") + 1, 0, link);
      out.related_identifiers = rel;
      fs.writeFileSync(".zenodo.json", JSON.stringify(out, null, 2) + "\n");
    '
    echo "version: .zenodo.json is at ${version}, published ${date}, linked to ${repo}/tree/v${version}."
  fi
}

check() {
  local version="$1" found fail=0
  valid "$version"
  found="$(node -p 'require("./package.json").version')"
  [[ "$found" == "$version" ]] || { echo "version: package.json is at ${found}, not ${version}." >&2; fail=1; }
  if [[ -f CITATION.cff ]]; then
    found="$(sed -nE 's/^version:[[:space:]]*"?([^"]*)"?[[:space:]]*$/\1/p' CITATION.cff)"
    [[ "$found" == "$version" ]] || { echo "version: CITATION.cff is at ${found:-nothing}, not ${version}." >&2; fail=1; }
  fi
  if [[ -f .zenodo.json ]]; then
    found="$(node -p 'JSON.parse(require("node:fs").readFileSync(".zenodo.json", "utf8")).version')"
    [[ "$found" == "$version" ]] || { echo "version: .zenodo.json is at ${found}, not ${version}." >&2; fail=1; }
  fi
  [[ "$fail" -eq 0 ]] || exit 1
  echo "version: every place holds ${version}."
}

self_test() {
  local script work status
  script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
  work="$(mktemp -d)"
  self_test_work="$work"
  trap 'rm -r -- "$self_test_work"' EXIT
  mkdir -p "$work/scripts/release"
  cp "$script" "$work/scripts/release/version.sh"
  printf '{\n  "name": "x",\n  "version": "0.0.0",\n  "private": true\n}\n' > "$work/package.json"
  run() { (cd "$work" && bash scripts/release/version.sh "$@") > "$work/out" 2>&1; }

  status=0; run --check 0.1.0 || status=$?
  [[ "$status" -eq 1 ]] || { echo "version: self-test failed: --check passed a stale package.json" >&2; exit 1; }
  run 0.1.0 2026-11-11 || { cat "$work/out" >&2; echo "version: self-test failed: the write was refused" >&2; exit 1; }
  printf '{\n  "name": "x",\n  "version": "0.1.0",\n  "private": true\n}\n' | cmp -s - "$work/package.json" \
    || { echo "version: self-test failed: package.json changed beyond its version" >&2; exit 1; }
  run --check 0.1.0 || { echo "version: self-test failed: --check refused the written version" >&2; exit 1; }

  printf 'cff-version: 1.2.0\ntitle: x\nversion: "0.1.0"\ndate-released: "2026-11-11"\n' > "$work/CITATION.cff"
  run 0.2.0-rc.1 2026-12-01 || { cat "$work/out" >&2; echo "version: self-test failed: the write with CITATION.cff was refused" >&2; exit 1; }
  grep -qx 'version: "0.2.0-rc.1"' "$work/CITATION.cff" || { echo "version: self-test failed: CITATION.cff version" >&2; exit 1; }
  grep -qx 'date-released: "2026-12-01"' "$work/CITATION.cff" || { echo "version: self-test failed: CITATION.cff date" >&2; exit 1; }
  run --check 0.2.0-rc.1 || { echo "version: self-test failed: --check with CITATION.cff" >&2; exit 1; }

  # Before the first release: no date-released, no publication_date, no tag link.
  printf 'cff-version: 1.2.0\ntitle: x\nrepository-code: "https://example.org/x"\nversion: "0.2.0-rc.1"\nkeywords:\n  - y\n' > "$work/CITATION.cff"
  printf '{\n  "title": "x",\n  "description": "<p>x</p>",\n  "version": "0.2.0-rc.1",\n  "related_identifiers": [\n    {\n      "identifier": "https://example.org/docs/",\n      "relation": "isDocumentedBy"\n    }\n  ]\n}\n' > "$work/.zenodo.json"
  status=0; run --check 0.2.0 || status=$?
  [[ "$status" -eq 1 ]] || { echo "version: self-test failed: --check passed a stale .zenodo.json" >&2; exit 1; }
  run 0.2.0 2026-12-02 || { cat "$work/out" >&2; echo "version: self-test failed: the first dated cut was refused" >&2; exit 1; }
  [[ "$(sed -n 4,5p "$work/CITATION.cff")" == $'version: "0.2.0"\ndate-released: "2026-12-02"' ]] \
    || { echo "version: self-test failed: the first cut did not add date-released after version" >&2; exit 1; }
  run 0.2.1 2026-12-03 || { cat "$work/out" >&2; echo "version: self-test failed: the second cut was refused" >&2; exit 1; }
  [[ "$(grep -c '^date-released:' "$work/CITATION.cff")" -eq 1 ]] || { echo "version: self-test failed: date-released twice" >&2; exit 1; }
  grep -qx 'date-released: "2026-12-03"' "$work/CITATION.cff" || { echo "version: self-test failed: CITATION.cff date on a later cut" >&2; exit 1; }
  jq -e '
    (keys_unsorted == ["title", "description", "publication_date", "version", "related_identifiers"])
    and .version == "0.2.1" and .publication_date == "2026-12-03"
    and .related_identifiers == [
      {identifier: "https://example.org/docs/", relation: "isDocumentedBy"},
      {identifier: "https://example.org/x/tree/v0.2.1", relation: "isSupplementTo", resource_type: "software"}
    ]' "$work/.zenodo.json" > /dev/null \
    || { cat "$work/.zenodo.json" >&2; echo "version: self-test failed: .zenodo.json after two cuts" >&2; exit 1; }
  run --check 0.2.1 || { echo "version: self-test failed: --check with .zenodo.json" >&2; exit 1; }
  status=0; run 1.0 || status=$?
  [[ "$status" -eq 1 ]] || { echo "version: self-test failed: a version that is no version was written" >&2; exit 1; }
  echo "version: self-test passed."
}

case "${1:-}" in
--self-test)
  [[ $# -eq 1 ]] || usage
  self_test
  ;;
--check)
  [[ $# -eq 2 ]] || usage
  cd "$(dirname "$0")/../.."
  check "$2"
  ;;
-*) usage ;;
"") usage ;;
*)
  [[ $# -le 2 ]] || usage
  cd "$(dirname "$0")/../.."
  write "$1" "${2:-$(date -u +%Y-%m-%d)}"
  ;;
esac
