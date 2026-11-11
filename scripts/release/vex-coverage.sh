#!/usr/bin/env bash
# SPDX-FileCopyrightText: Ruben Talstra
# SPDX-License-Identifier: Apache-2.0
#
# Joins Trivy JSON reports with the OpenVEX documents under security/vex/ and
# writes the release's vulnerability record. Every finding goes into the
# record. A finding at or above the severity floor that no statement judges
# refuses the release.
#
#   vex-coverage.sh [--min-severity LEVEL] [--vex-dir DIR] \
#     --record OUT.json PRODUCT=REPORT.json [PRODUCT=REPORT.json ...]
#   vex-coverage.sh --self-test
#
# PRODUCT is the product id a statement names, such as pkg:oci/edulims. A
# statement matches a finding when its vulnerability `name` or one of its
# `aliases` is the finding's id, and one of its products is PRODUCT or starts
# with PRODUCT followed by "@" or "?". It judges the finding when it is
# `not_affected` with a `justification` or an `impact_statement`, `affected`
# with an `action_statement`, or `fixed`. `under_investigation` judges nothing.
#
# The floor is HIGH by default (security/vex/README.md says why). Exit 0 when
# every finding at or above it is judged, 1 otherwise, 2 on a usage error.
set -euo pipefail
export LC_ALL=C

usage() {
  echo "usage: vex-coverage.sh [--min-severity LEVEL] [--vex-dir DIR] --record OUT PRODUCT=REPORT..." >&2
  echo "       vex-coverage.sh --self-test" >&2
  exit 2
}

# record MIN VEXDIR OUT TARGET...: writes OUT and returns 1 on an unjudged
# finding at or above MIN.
record() {
  local min="$1" vexdir="$2" out="$3"
  shift 3
  local statements targets='[]' entry product report doc
  statements='[]'
  for doc in "$vexdir"/*.json; do
    [[ -e "$doc" ]] || continue
    jq -e '.["@context"] | tostring | startswith("https://openvex.dev/ns")' "$doc" > /dev/null \
      || { echo "vex-coverage: $doc is not an OpenVEX document" >&2; return 1; }
    statements="$(jq -c --argjson acc "$statements" --arg doc "$doc" \
      '$acc + [(.statements // [])[] | . + {document: $doc}]' "$doc")"
  done
  for entry in "$@"; do
    [[ "$entry" == *=* ]] || usage
    product="${entry%%=*}"
    report="${entry#*=}"
    [[ -f "$report" ]] || { echo "vex-coverage: no report at $report" >&2; return 1; }
    targets="$(jq -c --argjson acc "$targets" --arg product "$product" --arg report "$report" \
      '$acc + [{product: $product, report: $report, findings: [
        .Results[]? | .Target as $t | (.Vulnerabilities // [])[]
        | {id: .VulnerabilityID, package: .PkgName, installed: .InstalledVersion,
           fixed: (.FixedVersion // ""), severity: .Severity, target: $t}
      ]}]' "$report")"
  done

  jq -n --argjson statements "$statements" --argjson targets "$targets" --arg min "$min" '
    def rank: {"UNKNOWN": 0, "LOW": 1, "MEDIUM": 2, "HIGH": 3, "CRITICAL": 4}[.] // 0;
    def names: [.vulnerability.name] + (.vulnerability.aliases // []);
    def covers($p): any(.products[]?; (.["@id"] // .) as $id
      | $id == $p or ($id | startswith($p + "@")) or ($id | startswith($p + "?")));
    def judges: (.status == "not_affected" and ((.justification // "") != "" or (.impact_statement // "") != ""))
      or (.status == "affected" and (.action_statement // "") != "")
      or (.status == "fixed");
    ($min | rank) as $floor
    | [ $targets[] | .product as $p | .findings[]
        | . as $f
        | ([ $statements[] | select((names | index($f.id)) != null and covers($p)) ] | map(select(judges))) as $s
        | $f + {product: $p,
                judged: ($s | length > 0),
                status: ($s[0].status // null),
                statement: ($s[0].document // null),
                gated: (($f.severity | rank) >= $floor)} ]
    | unique_by([.product, .id, .package, .installed, .target])
    | {
        generator: "scripts/release/vex-coverage.sh",
        min_severity: $min,
        summary: {
          findings: length,
          judged: map(select(.judged)) | length,
          unjudged_at_or_above_floor: map(select(.gated and (.judged | not))) | length
        },
        findings: .
      }' > "$out"

  local missing
  missing="$(jq -r '.findings[] | select(.gated and (.judged | not))
    | "\(.product) \(.id) \(.severity) \(.package) \(.installed) (fix: \(if .fixed == "" then "none" else .fixed end))"' "$out")"
  jq -r '"vex-coverage: \(.summary.findings) finding(s), \(.summary.judged) judged, \(.summary.unjudged_at_or_above_floor) unjudged at or above \(.min_severity)."' "$out"
  if [[ -n "$missing" ]]; then
    echo "vex-coverage: these findings need an OpenVEX statement under security/vex/ (security/vex/README.md), or a fix:" >&2
    printf '  %s\n' "$missing" >&2
    return 1
  fi
}

self_test() {
  local work status
  work="$(mktemp -d)"
  self_test_work="$work"
  trap 'rm -r -- "$self_test_work"' EXIT
  mkdir -p "$work/vex"
  cat > "$work/report.json" <<'EOF'
{"Results": [{"Target": "debian 13", "Vulnerabilities": [
  {"VulnerabilityID": "CVE-2026-0001", "PkgName": "libc6", "InstalledVersion": "2.41-1", "Severity": "HIGH"},
  {"VulnerabilityID": "CVE-2026-0002", "PkgName": "zlib1g", "InstalledVersion": "1.3", "FixedVersion": "1.3.1", "Severity": "CRITICAL"},
  {"VulnerabilityID": "CVE-2026-0003", "PkgName": "tzdata", "InstalledVersion": "2026a", "Severity": "LOW"}
]}]}
EOF
  cat > "$work/vex/os.openvex.json" <<'EOF'
{"@context": "https://openvex.dev/ns/v0.2.0", "@id": "https://example.org/vex/1", "author": "self-test",
 "timestamp": "2026-11-11T00:00:00Z", "version": 1, "statements": [
  {"vulnerability": {"name": "CVE-2026-0001"}, "products": [{"@id": "pkg:oci/edulims"}],
   "status": "not_affected", "justification": "vulnerable_code_not_in_execute_path"},
  {"vulnerability": {"name": "GHSA-xxxx-0002", "aliases": ["CVE-2026-0002"]}, "products": [{"@id": "pkg:oci/other"}],
   "status": "not_affected", "justification": "component_not_present"}
]}
EOF
  status=0
  record HIGH "$work/vex" "$work/out.json" "pkg:oci/edulims=$work/report.json" > "$work/log" 2>&1 || status=$?
  [[ "$status" -eq 1 ]] || { cat "$work/log" >&2; echo "vex-coverage: self-test failed: an unjudged CRITICAL passed" >&2; exit 1; }
  grep -q 'CVE-2026-0002' "$work/log" || { echo "vex-coverage: self-test failed: the unjudged finding was not named" >&2; exit 1; }
  grep -q 'CVE-2026-0003' "$work/log" && { echo "vex-coverage: self-test failed: a LOW finding was gated at HIGH" >&2; exit 1; }
  [[ "$(jq '.summary.findings' "$work/out.json")" -eq 3 ]] || { echo "vex-coverage: self-test failed: the record lost a finding" >&2; exit 1; }

  # The alias matches once the statement names the product.
  jq '.statements[1].products = [{"@id": "pkg:oci/edulims@sha256:abc"}]' "$work/vex/os.openvex.json" > "$work/vex/tmp"
  mv "$work/vex/tmp" "$work/vex/os.openvex.json"
  record HIGH "$work/vex" "$work/out.json" "pkg:oci/edulims=$work/report.json" > "$work/log" 2>&1 \
    || { cat "$work/log" >&2; echo "vex-coverage: self-test failed: a judged release was refused" >&2; exit 1; }

  # A statement without a justification or an impact statement judges nothing.
  jq '.statements[0] |= del(.justification)' "$work/vex/os.openvex.json" > "$work/vex/tmp"
  mv "$work/vex/tmp" "$work/vex/os.openvex.json"
  status=0
  record HIGH "$work/vex" "$work/out.json" "pkg:oci/edulims=$work/report.json" > "$work/log" 2>&1 || status=$?
  [[ "$status" -eq 1 ]] || { echo "vex-coverage: self-test failed: a bare not_affected judged a finding" >&2; exit 1; }

  # At floor LOW the tzdata finding is gated as well.
  status=0
  record LOW "$work/vex" "$work/out.json" "pkg:oci/edulims=$work/report.json" > "$work/log" 2>&1 || status=$?
  grep -q 'CVE-2026-0003' "$work/log" || { echo "vex-coverage: self-test failed: the LOW floor did not gate LOW" >&2; exit 1; }
  echo "vex-coverage: self-test passed."
}

min=HIGH
vexdir=security/vex
out=""
case "${1:-}" in
--self-test)
  [[ $# -eq 1 ]] || usage
  self_test
  exit 0
  ;;
esac
while [[ $# -gt 0 ]]; do
  case "$1" in
  --min-severity)
    [[ $# -ge 2 ]] || usage
    min="$2"
    shift 2
    ;;
  --vex-dir)
    [[ $# -ge 2 ]] || usage
    vexdir="$2"
    shift 2
    ;;
  --record)
    [[ $# -ge 2 ]] || usage
    out="$2"
    shift 2
    ;;
  -*) usage ;;
  *) break ;;
  esac
done
[[ -n "$out" && $# -gt 0 ]] || usage
case "$min" in UNKNOWN | LOW | MEDIUM | HIGH | CRITICAL) ;; *) usage ;; esac
record "$min" "$vexdir" "$out" "$@"
