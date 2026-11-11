#!/usr/bin/env bash
# SPDX-FileCopyrightText: Ruben Talstra
# SPDX-License-Identifier: Apache-2.0
# The citation guard (no specification governs it: our own design, ported
# from FerroEHR's citation-guard). A malformed CITATION.cff silently breaks
# GitHub's "Cite this repository" button, and Zenodo reads only .zenodo.json
# when both files exist (https://help.zenodo.org/docs/github/describe-software/zenodo-json/),
# so the two are held to each other here:
#
#   * CITATION.cff validates against the vendored CFF 1.2.0 schema
#     (.github/cff-schema/schema.json);
#   * CITATION.cff `version` == package.json `version` == .zenodo.json `version`;
#   * title, abstract (as the description), licence, authors with ORCID and
#     keywords agree between CITATION.cff and .zenodo.json;
#   * `date-released` == `publication_date`, both present or both absent, and
#     once released, .zenodo.json's isSupplementTo is the tag's tree URL;
#   * .zenodo.json is a software deposit with open access, documented by
#     <url>/docs/.
#
# scripts/release/version.sh writes every one of these release facts.
#
# Usage:
#   scripts/checks/citation.sh
#   scripts/checks/citation.sh --self-test
#
# Needs bash, jq, mikefarah yq 4, and python3 with venv and pip: the schema
# validator is fastjsonschema (pure Python, no dependencies), installed into a
# throwaway virtual environment from PyPI with --require-hashes. Set
# CITATION_VENV to a directory to reuse one environment across runs.
#
# Exit 0 when the metadata holds, 1 when it does not, 2 on a usage error or a
# missing tool.
set -euo pipefail
export LC_ALL=C

readonly FASTJSONSCHEMA_VERSION="2.22.3"
# sha256 of fastjsonschema-2.22.3-py3-none-any.whl, read from PyPI.
readonly FASTJSONSCHEMA_SHA256="f670b443830b75aca3f00b75949efa20f4b2a80302ec7a21505c28dd54cffd43"

usage() {
  sed -n '/^# Usage:/,/^$/p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

need() {
  command -v "$1" >/dev/null || { echo "citation: $1 is required" >&2; exit 2; }
}

tools() {
  need jq
  need yq
  need python3
  yq --version 2>&1 | grep -q 'mikefarah' || { echo "citation: yq must be mikefarah yq 4 (https://github.com/mikefarah/yq)" >&2; exit 2; }
}

# The venv's python with the pinned validator, created on first use.
validator() {
  local venv="${CITATION_VENV:-}"
  if [[ -z "$venv" ]]; then
    venv="$(mktemp -d)"
    validator_tmp="$venv"
    trap 'rm -rf -- "$validator_tmp"' EXIT
  fi
  if ! "$venv/bin/python" -I -c "import importlib.metadata as m, sys; sys.exit(m.version('fastjsonschema') != '${FASTJSONSCHEMA_VERSION}')" 2>/dev/null; then
    python3 -I -m venv "$venv"
    printf 'fastjsonschema==%s --hash=sha256:%s\n' "$FASTJSONSCHEMA_VERSION" "$FASTJSONSCHEMA_SHA256" > "$venv/requirements.txt"
    "$venv/bin/python" -I -m pip install --quiet --disable-pip-version-check --no-input \
      --retries 5 --timeout 30 --require-hashes --only-binary :all: --no-deps \
      -r "$venv/requirements.txt" >&2
  fi
  PYTHON="$venv/bin/python"
}

# schema_errors <schema.json> <document.json>: prints the first violation.
schema_errors() {
  "$PYTHON" -I -c '
import json, sys
import fastjsonschema
with open(sys.argv[1], encoding="utf-8") as f:
    validate = fastjsonschema.compile(json.load(f))
with open(sys.argv[2], encoding="utf-8") as f:
    document = json.load(f)
try:
    validate(document)
except fastjsonschema.JsonSchemaException as error:
    print(error.message)
' "$1" "$2"
}

# The agreement rules, one message per broken rule.
# shellcheck disable=SC2016 # a jq program: its $names are jq variables.
readonly AGREEMENT='
  ($c[0]) as $c | ($z[0]) as $z
  | ($z.related_identifiers // []) as $rel
  | ($c.authors | map(
      {name: (.["family-names"] + ", " + .["given-names"])}
      + (if .orcid then {orcid: (.orcid | sub("^https://orcid\\.org/"; ""))} else {} end)
    )) as $creators
  | (if $c.version != $pkg then "CITATION.cff version \($c.version) is not package.json version \($pkg)" else empty end),
    (if $z.version != $pkg then ".zenodo.json version \($z.version) is not package.json version \($pkg)" else empty end),
    (if $z.title != $c.title then ".zenodo.json title \($z.title | tojson) is not CITATION.cff title \($c.title | tojson)" else empty end),
    (if $z.description != ("<p>" + $c.abstract + "</p>") then ".zenodo.json description is not <p>CITATION.cff abstract</p>" else empty end),
    (if $z.license != ($c.license | ascii_downcase) then ".zenodo.json license \($z.license) is not CITATION.cff license \($c.license) in lower case" else empty end),
    (if $z.keywords != $c.keywords then ".zenodo.json keywords differ from CITATION.cff keywords (same order)" else empty end),
    (if ($z.creators | map({name, orcid} | with_entries(select(.value != null)))) != $creators
      then ".zenodo.json creators differ from CITATION.cff authors (\"Family, Given\" and the bare ORCID)" else empty end),
    (if ($c["date-released"] // null) != ($z.publication_date // null)
      then "CITATION.cff date-released \($c["date-released"] // "absent") is not .zenodo.json publication_date \($z.publication_date // "absent")" else empty end),
    ([$rel[] | select(.relation == "isSupplementTo")] as $s
      | if $c["date-released"] == null then
          (if ($s | length) > 0 then ".zenodo.json has an isSupplementTo before the first release" else empty end)
        else
          ($c["repository-code"] + "/tree/v" + $c.version) as $tree
          | if $s != [{identifier: $tree, relation: "isSupplementTo", resource_type: "software"}]
              then ".zenodo.json needs exactly one isSupplementTo, the tag tree \($tree)" else empty end
        end),
    (($c.url | rtrimstr("/")) + "/docs/") as $docs
      | (if any($rel[]; .relation == "isDocumentedBy" and .identifier == $docs) | not
          then ".zenodo.json has no isDocumentedBy \($docs)" else empty end),
    (if $z.upload_type != "software" then ".zenodo.json upload_type is not software" else empty end),
    (if $z.access_right != "open" then ".zenodo.json access_right is not open" else empty end),
    (if $z | has("doi") then ".zenodo.json carries a doi; Zenodo mints it" else empty end)
'

# check <root>: every rule over the files under <root>.
check() {
  local root="$1" work errors pkg file
  for file in CITATION.cff .zenodo.json package.json .github/cff-schema/schema.json; do
    [[ -f "$root/$file" ]] || { echo "::error::citation: $file is missing" >&2; return 1; }
  done
  work="$(mktemp -d)"
  errors="$work/errors"
  : > "$errors"
  if ! yq -o=json '.' "$root/CITATION.cff" > "$work/cff.json" 2> "$work/yq.err"; then
    echo "::error::citation: CITATION.cff is not YAML: $(cat "$work/yq.err")" >&2
    rm -r -- "$work"
    return 1
  fi
  if ! jq -e . "$root/.zenodo.json" > /dev/null 2>&1; then
    echo "::error::citation: .zenodo.json is not JSON" >&2
    rm -r -- "$work"
    return 1
  fi
  schema_errors "$root/.github/cff-schema/schema.json" "$work/cff.json" \
    | sed 's/^/CITATION.cff does not match the CFF 1.2.0 schema: /' >> "$errors"
  pkg="$(jq -r '.version // ""' "$root/package.json")"
  jq -r -n --slurpfile c "$work/cff.json" --slurpfile z "$root/.zenodo.json" --arg pkg "$pkg" \
    "$AGREEMENT" >> "$errors"
  if [[ -s "$errors" ]]; then
    sed 's/^/::error::citation: /' "$errors" >&2
    echo "citation: the release cut sets these with scripts/release/version.sh (docs/release.md)." >&2
    rm -r -- "$work"
    return 1
  fi
  rm -r -- "$work"
  echo "citation: CITATION.cff is schema-valid and agrees with package.json and .zenodo.json at ${pkg}."
}

self_test() {
  local here repo status
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  repo="$(cd "$here/../.." && pwd)"
  work="$(mktemp -d)"
  trap 'rm -rf -- "$work"' EXIT
  CITATION_VENV="${CITATION_VENV:-$work/venv}"
  validator

  fresh() {
    rm -rf -- "$work/repo"
    mkdir -p "$work/repo/.github/cff-schema" "$work/repo/scripts/release"
    cp "$repo/CITATION.cff" "$repo/.zenodo.json" "$repo/package.json" "$work/repo/"
    cp "$repo/.github/cff-schema/schema.json" "$work/repo/.github/cff-schema/"
    cp "$repo/scripts/release/version.sh" "$work/repo/scripts/release/"
  }
  zen() {
    jq "$1" "$work/repo/.zenodo.json" > "$work/z" && mv "$work/z" "$work/repo/.zenodo.json"
  }
  # expect NAME WANT: the check over the scratch repository exits WANT.
  expect() {
    local name=$1 want=$2
    status=0
    check "$work/repo" > "$work/out" 2>&1 || status=$?
    if [[ "$status" -ne "$want" ]]; then
      cat "$work/out" >&2
      echo "citation: self-test failed: $name exited $status, wanted $want." >&2
      exit 1
    fi
  }

  fresh; expect "the committed metadata" 0
  fresh; zen '.version = "9.9.9"'; expect "a stale .zenodo.json version" 1
  fresh; yq -i '.version = "9.9.9"' "$work/repo/CITATION.cff"; expect "a CITATION.cff version ahead of package.json" 1
  fresh; jq '.version = "9.9.9"' "$repo/package.json" > "$work/repo/package.json"; expect "a package.json bumped alone" 1
  fresh; zen '.title = "Something else"'; expect "a different title" 1
  fresh; zen '.license = "mit"'; expect "a different licence" 1
  fresh; zen '.keywords |= .[1:]'; expect "a dropped keyword" 1
  fresh; zen '.creators[0].orcid = "0000-0000-0000-0000"'; expect "a different ORCID" 1
  fresh; zen '.description = "<p>Other.</p>"'; expect "a different description" 1
  fresh; zen '.access_right = "closed"'; expect "a closed deposit" 1
  fresh; zen '.related_identifiers |= map(select(.relation != "isDocumentedBy"))'; expect "no isDocumentedBy" 1
  fresh; yq -i '.authors[0].orcid = "0009-0009-2758-0141"' "$work/repo/CITATION.cff"; expect "a bare ORCID (schema)" 1
  fresh; yq -i '.colour = "blue"' "$work/repo/CITATION.cff"; expect "an unknown CITATION.cff key (schema)" 1
  fresh; yq -i '.["date-released"] = "2026-12-01"' "$work/repo/CITATION.cff"; expect "a date-released without a publication_date" 1
  fresh; zen '.related_identifiers += [{identifier: "x", relation: "isSupplementTo", resource_type: "software"}]'
  expect "an isSupplementTo before the first release" 1

  # A release cut by version.sh leaves every rule holding.
  fresh
  (cd "$work/repo" && bash scripts/release/version.sh 0.1.0 2026-12-01) > "$work/out" 2>&1 \
    || { cat "$work/out" >&2; echo "citation: self-test failed: version.sh refused the cut" >&2; exit 1; }
  expect "the metadata after a cut" 0
  zen '.publication_date = "2026-12-02"'; expect "a publication_date that differs from date-released" 1
  fresh
  (cd "$work/repo" && bash scripts/release/version.sh 0.1.0 2026-12-01) > /dev/null 2>&1
  zen '(.related_identifiers[] | select(.relation == "isSupplementTo") | .identifier) |= sub("v0.1.0$"; "v0.0.9")'
  expect "an isSupplementTo on another tag" 1
  echo "citation: self-test passed."
}

case "$#:${1:-}" in
  1:--self-test)
    tools
    self_test
    ;;
  1:*) usage ;;
  0:)
    tools
    validator
    check "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
    ;;
  *) usage ;;
esac
