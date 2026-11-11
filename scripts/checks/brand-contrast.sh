#!/usr/bin/env bash
# SPDX-FileCopyrightText: Ruben Talstra
# SPDX-License-Identifier: Apache-2.0
#
# The brand palette's contrast against the three grounds it is drawn on (the
# light surface, the dark background and the indigo tile), measured from
# assets/brand/tokens.css and checked against what that file and the brand
# README claim.
#
#   scripts/checks/brand-contrast.sh              # check the claims
#   scripts/checks/brand-contrast.sh --table      # print the table for the README
#   scripts/checks/brand-contrast.sh --self-test  # prove the check refuses a false claim
#
# WCAG 2.1 asks 4.5:1 for body text and 3:1 for a graphical object or large text
# (SC 1.4.3, SC 1.4.11). Every core token carries a `safe:` comment naming what
# it may be used for on each ground; a comment or README row that stops matching
# the measurement fails here. BRAND_ROOT points the check at another tree (the
# self-test uses it).
set -euo pipefail

self_test() {
  local scratch script status
  scratch=$(mktemp -d)
  trap 'rm -rf "$scratch"' RETURN
  script="${BASH_SOURCE[0]}"
  mkdir -p "$scratch/assets/brand"

  write_tokens() {
    cat >"$scratch/assets/brand/tokens.css" <<EOF
:root {
  --edulims-indigo: #3730a3; /* safe: light: text, dark: neither, tile: neither */
  --edulims-black: #000000; /* safe: $1 */
  --edulims-night: #0b1220; /* safe: light: text, dark: neither, tile: neither */
  --edulims-surface: #ffffff; /* safe: light: neither, dark: text, tile: text */
}
EOF
  }
  write_readme() {
    BRAND_ROOT="$scratch" bash "$script" --table >"$scratch/assets/brand/README.md"
  }

  # A true claim and a measured README pass; 21:1 is the WCAG maximum.
  write_tokens "light: text, dark: neither, tile: neither"
  write_readme
  grep -qF "| \`#000000\` | 21.00 |" "$scratch/assets/brand/README.md" || {
    echo "self-test: black on white does not measure 21.00" >&2
    return 1
  }
  BRAND_ROOT="$scratch" bash "$script" >/dev/null || {
    echo "self-test: a true claim failed" >&2
    return 1
  }

  # A claim that says more than the ratio allows fails.
  write_tokens "light: text, dark: text, tile: neither"
  status=0
  BRAND_ROOT="$scratch" bash "$script" >/dev/null 2>&1 || status=$?
  [[ $status -ne 0 ]] || {
    echo "self-test: a false claim passed" >&2
    return 1
  }

  # A README row that does not carry the measured figures fails.
  write_tokens "light: text, dark: neither, tile: neither"
  write_readme
  sed -i.bak 's/| 21.00 |/| 20.00 |/' "$scratch/assets/brand/README.md"
  status=0
  BRAND_ROOT="$scratch" bash "$script" >/dev/null 2>&1 || status=$?
  [[ $status -ne 0 ]] || {
    echo "self-test: a stale README passed" >&2
    return 1
  }

  # A token with no claim fails.
  sed -i.bak 's|/\* safe: light: text, dark: neither, tile: neither \*/||' "$scratch/assets/brand/tokens.css"
  status=0
  BRAND_ROOT="$scratch" bash "$script" >/dev/null 2>&1 || status=$?
  [[ $status -ne 0 ]] || {
    echo "self-test: a token without a claim passed" >&2
    return 1
  }

  echo "brand-contrast self-test: ok"
}

if [[ "${1:-}" == "--self-test" ]]; then
  self_test
  exit $?
fi

root="${BRAND_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$root"

readonly TOKENS=assets/brand/tokens.css
readonly DOC=assets/brand/README.md

value_of() {
  awk -F'[:;]' -v name="--edulims-$1" '$1 ~ "^[[:space:]]*"name"$" {gsub(/ /,"",$2); print $2; exit}' "$TOKENS"
}
LIGHT=$(value_of surface)
DARK=$(value_of night)
TILE=$(value_of indigo)
if [[ -z "$LIGHT" || -z "$DARK" || -z "$TILE" ]]; then
  echo "brand-contrast: $TOKENS needs --edulims-surface, --edulims-night and --edulims-indigo" >&2
  exit 1
fi

# Every core token: name, value and the `safe:` claim of its comment, tab-separated.
ROWS=$(awk '
  /--edulims-[a-z0-9-]+:[[:space:]]*#/ {
    split($0, parts, ":")
    name = parts[1]; gsub(/[[:space:]]*--edulims-/, "", name); gsub(/[[:space:]]/, "", name)
    value = parts[2]; sub(/;.*/, "", value); gsub(/[[:space:]]/, "", value)
    claim = ""
    if (match($0, /safe:[^*]*/)) {
      claim = substr($0, RSTART + 5, RLENGTH - 5)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", claim)
    }
    print name "\t" tolower(value) "\t" claim
  }
' "$TOKENS")

# The WCAG 2.1 contrast ratio of two #rrggbb colours, to two decimals.
measure() {
  awk -v a="$1" -v b="$2" '
    function hexval(pair,   digits, i, v) {
      digits = "0123456789abcdef"; v = 0
      for (i = 1; i <= length(pair); i++) v = v * 16 + index(digits, tolower(substr(pair, i, 1))) - 1
      return v
    }
    function chan(v,   s) { s = v / 255; return (s <= 0.04045) ? s / 12.92 : ((s + 0.055) / 1.055) ^ 2.4 }
    function lum(hex) {
      return 0.2126 * chan(hexval(substr(hex, 2, 2))) \
           + 0.7152 * chan(hexval(substr(hex, 4, 2))) \
           + 0.0722 * chan(hexval(substr(hex, 6, 2)))
    }
    BEGIN {
      la = lum(a); lb = lum(b)
      hi = (la > lb) ? la : lb; lo = (la > lb) ? lb : la
      printf "%.2f\n", (hi + 0.05) / (lo + 0.05)
    }
  '
}

# What a ratio permits, in the words a `safe:` comment uses.
verdict() {
  awk -v r="$1" 'BEGIN { print (r >= 4.5) ? "text" : (r >= 3) ? "graphics" : "neither" }'
}

failures=0
table=""
while IFS=$'\t' read -r name value claim; do
  [[ -n "$name" ]] || continue
  light=$(measure "$value" "$LIGHT")
  dark=$(measure "$value" "$DARK")
  tile=$(measure "$value" "$TILE")
  measured="light: $(verdict "$light"), dark: $(verdict "$dark"), tile: $(verdict "$tile")"
  table+="| \`--edulims-$name\` | \`$value\` | $light | $dark | $tile | $measured |"$'\n'
  if [[ -z "$claim" ]]; then
    echo "brand-contrast: --edulims-$name carries no 'safe:' comment; it measures $measured" >&2
    failures=$((failures + 1))
  elif [[ "$claim" != "$measured" ]]; then
    echo "brand-contrast: --edulims-$name claims '$claim' and measures '$measured'" >&2
    failures=$((failures + 1))
  fi
done <<<"$ROWS"

if [[ "${1:-}" == "--table" ]]; then
  printf '| Token | Value | On %s | On %s | On %s | Safe for |\n' "$LIGHT" "$DARK" "$TILE"
  printf '|---|---|---|---|---|---|\n'
  printf '%s' "$table"
  exit 0
fi

# The README carries the same figures, so a reader who never opens the CSS gets
# a table that was measured rather than remembered.
while IFS= read -r row; do
  [[ -n "$row" ]] || continue
  if ! grep -qF -- "$row" "$DOC"; then
    echo "brand-contrast: $DOC does not carry the measured row: $row" >&2
    failures=$((failures + 1))
  fi
done <<<"$table"

if ((failures > 0)); then
  echo "brand-contrast: $failures claims do not match the measurement" >&2
  echo "  re-run with --table for the figures, and fix the claim rather than the threshold" >&2
  exit 1
fi

echo "brand-contrast: every token's claim matches what it measures ($(grep -c . <<<"$ROWS") tokens)."
