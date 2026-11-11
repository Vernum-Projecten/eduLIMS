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
# the measurement fails here. The chart palette (`--edulims-chart-light-*` and
# `--edulims-chart-dark-*`) must reach 3:1 on the ground it is drawn on, and the
# application theme's destructive colour (src/styles/app.css) is measured as a
# label on its own tints, in light and dark. BRAND_ROOT points the check at
# another tree (the self-test uses it).
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
    BRAND_ROOT="$scratch" bash "$script" --table >"$scratch/assets/brand/README.md" 2>/dev/null
  }
  # A theme with the given light and dark --destructive, on shadcn's neutral surfaces.
  write_theme() {
    mkdir -p "$scratch/src/styles"
    cat >"$scratch/src/styles/app.css" <<EOF
:root {
  --background: oklch(1 0 0);
  --card: oklch(1 0 0);
  --popover: oklch(1 0 0);
  --muted: oklch(0.97 0 0);
  --destructive: $1;
}

:root {
  @variant dark {
    --background: oklch(0.145 0 0);
    --card: oklch(0.205 0 0);
    --popover: oklch(0.205 0 0);
    --muted: oklch(0.269 0 0);
    --destructive: $2;
  }
}
EOF
  }
  write_theme "#9f0712" "#ffc9c9"

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

  # shadcn's stock destructive reds measure below 4.5:1 on their tints and fail,
  # in each scheme on its own.
  write_readme
  for pair in "oklch(0.577 0.245 27.325)|#ffc9c9" "#9f0712|oklch(0.704 0.191 22.216)"; do
    write_theme "${pair%|*}" "${pair#*|}"
    status=0
    BRAND_ROOT="$scratch" bash "$script" >/dev/null 2>&1 || status=$?
    [[ $status -ne 0 ]] || {
      echo "self-test: a destructive colour under 4.5:1 passed ($pair)" >&2
      return 1
    }
  done
  write_theme "#9f0712" "#ffc9c9"

  # A token with no claim fails.
  sed -i.bak 's|/\* safe: light: text, dark: neither, tile: neither \*/||' "$scratch/assets/brand/tokens.css"
  status=0
  BRAND_ROOT="$scratch" bash "$script" >/dev/null 2>&1 || status=$?
  [[ $status -ne 0 ]] || {
    echo "self-test: a token without a claim passed" >&2
    return 1
  }

  # A chart colour under 3:1 on its own ground fails, even when its claim is true.
  cat >"$scratch/assets/brand/tokens.css" <<EOF
:root {
  --edulims-indigo: #3730a3; /* safe: light: text, dark: neither, tile: neither */
  --edulims-night: #0b1220; /* safe: light: text, dark: neither, tile: neither */
  --edulims-surface: #ffffff; /* safe: light: neither, dark: text, tile: text */
  --edulims-chart-light-1: #fbbf24; /* safe: light: neither, dark: text, tile: text */
}
EOF
  write_readme
  status=0
  BRAND_ROOT="$scratch" bash "$script" >/dev/null 2>&1 || status=$?
  [[ $status -ne 0 ]] || {
    echo "self-test: a chart colour under 3:1 on its ground passed" >&2
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

# The application theme's destructive colour, measured from src/styles/app.css in
# both schemes. The radix-nova button and badge draw their label in --destructive on
# a tint of itself (10% at rest and 20% on hover in light, 20% and 30% in dark),
# over the page, a card, a popover (dialogs, sheets) or the muted alert-dialog footer;
# the destructive alert draws its description at 90%. Each pair must reach 4.5:1
# (SC 1.4.3), which also covers the 3:1 of an icon or an invalid field's border.
readonly THEME=src/styles/app.css
readonly THEME_PAIRS="light 1 0.1 background
light 1 0.2 background
light 1 0.1 card
light 1 0.2 card
light 1 0.1 popover
light 1 0.2 popover
light 1 0.1 muted
light 1 0.2 muted
light 0.9 0 card
dark 1 0.2 background
dark 1 0.3 background
dark 1 0.2 card
dark 1 0.3 card
dark 1 0.2 popover
dark 1 0.3 popover
dark 1 0.2 muted
dark 1 0.3 muted
dark 0.9 0 card"

# theme_value <light|dark> <token>: the token's value in the first `:root {` block
# (light) or in the `@variant dark {` block (dark).
theme_value() {
  awk -v want="$1" -v name="--$2:" '
    /^:root \{/ && !seen { block = "light"; seen = 1; next }
    /@variant dark \{/ { block = "dark"; next }
    /^[[:space:]]*\}/ { block = "" }
    block == want {
      line = $0; sub(/^[[:space:]]+/, "", line)
      if (index(line, name) == 1) {
        value = substr(line, length(name) + 1); sub(/;.*/, "", value)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
        print value; exit
      }
    }
  ' "$THEME"
}

# theme_ratio <fg> <fg alpha> <tint alpha> <ground>: the contrast of <fg> at <fg alpha>
# over a <tint alpha> tint of <fg> on <ground>. Colours are #rrggbb or oklch(L C H);
# alpha composites in gamma-encoded sRGB, as browsers do.
theme_ratio() {
  awk -v fg="$1" -v fa="$2" -v ta="$3" -v ground="$4" '
    function hexval(pair,   digits, i, v) {
      digits = "0123456789abcdef"; v = 0
      for (i = 1; i <= length(pair); i++) v = v * 16 + index(digits, tolower(substr(pair, i, 1))) - 1
      return v
    }
    function encode(v) {
      if (v < 0) v = 0
      if (v > 1) v = 1
      return (v <= 0.0031308) ? 12.92 * v : 1.055 * v ^ (1 / 2.4) - 0.055
    }
    function srgb(spec, out,   n, p, L, C, H, a, b, l, m, s) {
      if (spec ~ /^#[0-9a-fA-F]{6}$/) {
        out[1] = hexval(substr(spec, 2, 2)) / 255
        out[2] = hexval(substr(spec, 4, 2)) / 255
        out[3] = hexval(substr(spec, 6, 2)) / 255
        return 1
      }
      if (spec !~ /^oklch\([0-9.]+ [0-9.]+ [0-9.]+\)$/) return 0
      gsub(/oklch\(|\)/, "", spec); n = split(spec, p, " ")
      L = p[1]; C = p[2]; H = p[3] * 3.141592653589793 / 180
      a = C * cos(H); b = C * sin(H)
      l = (L + 0.3963377774 * a + 0.2158037573 * b) ^ 3
      m = (L - 0.1055613458 * a - 0.0638541728 * b) ^ 3
      s = (L - 0.0894841775 * a - 1.2914855480 * b) ^ 3
      out[1] = encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)
      out[2] = encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)
      out[3] = encode(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)
      return 1
    }
    function chan(v) { return (v <= 0.04045) ? v / 12.92 : ((v + 0.055) / 1.055) ^ 2.4 }
    function lum(c) { return 0.2126 * chan(c[1]) + 0.7152 * chan(c[2]) + 0.0722 * chan(c[3]) }
    BEGIN {
      if (!srgb(fg, f) || !srgb(ground, g)) { print "unparsed"; exit }
      for (i = 1; i <= 3; i++) {
        surface[i] = f[i] * ta + g[i] * (1 - ta)
        text[i] = f[i] * fa + surface[i] * (1 - fa)
      }
      la = lum(text); lb = lum(surface)
      hi = (la > lb) ? la : lb; lo = (la > lb) ? lb : la
      printf "%.2f\n", (hi + 0.05) / (lo + 0.05)
    }
  '
}

# check_theme: prints a line per failing destructive pair; returns the number of failures.
check_theme() {
  local count=0 scheme fg_alpha tint ground fg bg ratio
  while read -r scheme fg_alpha tint ground; do
    fg=$(theme_value "$scheme" destructive)
    bg=$(theme_value "$scheme" "$ground")
    if [[ -z "$fg" || -z "$bg" ]]; then
      echo "brand-contrast: $THEME has no $scheme --destructive or --$ground" >&2
      count=$((count + 1))
      continue
    fi
    ratio=$(theme_ratio "$fg" "$fg_alpha" "$tint" "$bg")
    if [[ "$ratio" == unparsed ]]; then
      echo "brand-contrast: $THEME $scheme: cannot read '$fg' or '$bg' (use #rrggbb or oklch(L C H))" >&2
      count=$((count + 1))
    elif awk -v r="$ratio" 'BEGIN { exit !(r < 4.5) }'; then
      echo "brand-contrast: $THEME $scheme --destructive at $fg_alpha on a $tint tint over --$ground measures $ratio:1, below 4.5:1" >&2
      count=$((count + 1))
    fi
  done <<<"$THEME_PAIRS"
  return "$count"
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
  # A chart series colour must reach the graphics threshold on the ground it is drawn on
  # (SC 1.4.11): chart-light-* on the light surface, chart-dark-* on the dark background.
  case "$name" in
    chart-light-*) ground=light ratio=$light ;;
    chart-dark-*) ground=dark ratio=$dark ;;
    *) ground="" ratio="" ;;
  esac
  if [[ -n "$ground" && "$(verdict "$ratio")" == "neither" ]]; then
    echo "brand-contrast: --edulims-$name is a chart colour for $ground and measures $ratio:1 there, under 3:1" >&2
    failures=$((failures + 1))
  fi
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

theme_failures=0
check_theme || theme_failures=$?
failures=$((failures + theme_failures))

if ((failures > 0)); then
  echo "brand-contrast: $failures claims do not match the measurement" >&2
  echo "  re-run with --table for the figures, and fix the claim rather than the threshold" >&2
  exit 1
fi

echo "brand-contrast: every token's claim matches what it measures ($(grep -c . <<<"$ROWS") tokens), and the theme's destructive colour holds 4.5:1 ($(grep -c . <<<"$THEME_PAIRS") pairs)."
