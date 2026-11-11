#!/usr/bin/env bash
# SPDX-FileCopyrightText: Ruben Talstra
# SPDX-License-Identifier: Apache-2.0
# scripts/gh/project.sh: the GitHub Projects (v2) board helper.
#
# WHY THIS EXISTS: `gh project item-edit` takes opaque node ids (the project,
# the Status field, the option, and the item), never the issue number a
# person knows. This wrapper resolves all four from the issue number and
# fails loud on a typo. Ported from the Ferro family.
#
# The board is a view of the tracker: Status (Todo, In Progress, Done) is the
# only datum it manages. The type, priority and effort live on the issue
# (scripts/gh/fields.sh). The board is not created here: it is the
# organisation Project (v2) titled "eduLIMS Roadmap" (EDULIMS_PROJECT_TITLE
# overrides), with a single-select "Status" field. The token needs the
# `project` scope (`gh auth refresh -s project`).
#
# Official docs:
#   gh project commands .. https://cli.github.com/manual/gh_project
#   Projects v2 API ...... https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects
#
# Usage:
#   scripts/gh/project.sh add    <n>                         # put issue n on the board
#   scripts/gh/project.sh status <n> <todo|in-progress|done> # move issue n
#   scripts/gh/project.sh show   <n>                         # print issue n's Status
#   scripts/gh/project.sh url                                # print the board URL
#   scripts/gh/project.sh --self-test
#       Drives this program against a stub gh on PATH: a status move resolves
#       every id, an issue off the board is added first, an unknown status or
#       a missing board fails, and every usage error touches nothing.
#   No argument, an unknown command or a wrong operand count, --help
#   included, prints this usage and exits 2 before any gh call.

set -euo pipefail

TITLE="${EDULIMS_PROJECT_TITLE:-eduLIMS Roadmap}"

die() {
  echo "gh-project: $*" >&2
  exit 1
}

usage() {
  sed -n '/^# Usage:/,/^$/p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

self_test() {
  command -v jq >/dev/null 2>&1 || die "jq is not installed"
  local work stub calls
  work="$(mktemp -d)"
  stub="$work/bin"
  calls="$work/calls"
  mkdir -p "$stub"
  cat > "$stub/gh" <<'STUB'
#!/usr/bin/env bash
# The gh a self-test run of scripts/gh/project.sh speaks to.
set -euo pipefail
printf '%s\n' "$*" >> "$GH_STUB_CALLS"
filter=""
previous=""
for argument in "$@"; do
  [[ "$previous" == "--jq" ]] && filter="$argument"
  previous="$argument"
done
emit() { if [[ -n "$filter" ]]; then printf '%s' "$1" | jq -r "$filter"; else printf '%s\n' "$1"; fi; }
case "${1:-} ${2:-}" in
  "repo view") emit '{"nameWithOwner":"Example-Org/Example"}' ;;
  "project list") emit "$GH_STUB_PROJECTS" ;;
  "project field-list") emit '{"fields":[{"id":"F_status","name":"Status","options":[{"id":"O_todo","name":"Todo"},{"id":"O_prog","name":"In Progress"},{"id":"O_done","name":"Done"}]}]}' ;;
  "project item-add") touch "$GH_STUB_ADDED" ;;
  "project item-edit") ;;
  "api graphql")
    if [[ -e "$GH_STUB_ADDED" || "${GH_STUB_ON_BOARD:-yes}" == "yes" ]]; then
      emit '{"data":{"repository":{"issue":{"projectItems":{"nodes":[{"id":"I_item","project":{"id":"P_board"}}]}}}}}'
    else
      emit '{"data":{"repository":{"issue":{"projectItems":{"nodes":[]}}}}}'
    fi
    ;;
  "project item-list") emit '{"items":[{"id":"I_item","status":"In Progress","content":{"number":7}}]}' ;;
  *) echo "stub: an unexpected call: $*" >&2; exit 90 ;;
esac
STUB
  chmod 0755 "$stub/gh"

  local rc projects on_board
  run() {
    local name=$1 code=$2
    shift 2
    rc=0
    : > "$calls"
    rm -f "$work/added"
    PATH="$stub:$PATH" GH_STUB_CALLS="$calls" GH_STUB_PROJECTS="$projects" \
      GH_STUB_ON_BOARD="$on_board" GH_STUB_ADDED="$work/added" \
      bash "$0" "$@" > "$work/out" 2> "$work/err" || rc=$?
    if [[ "$rc" -ne "$code" ]]; then
      echo "gh-project: self-test failed: $name exited $rc, wanted $code." >&2
      cat "$work/out" "$work/err" "$calls" >&2
      exit 1
    fi
  }
  said() {
    grep -qF -- "$3" "$2" || {
      echo "gh-project: self-test failed: $1 did not say '$3'." >&2
      cat "$work/out" "$work/err" "$calls" >&2
      exit 1
    }
  }

  projects='{"projects":[{"number":4,"id":"P_board","title":"eduLIMS Roadmap","url":"https://github.com/orgs/Example-Org/projects/4"}]}'
  on_board=yes
  run "a status move" 0 status 7 in-progress
  said "a status move" "$work/out" "#7 is In Progress"
  said "a status move" "$calls" "project item-edit --id I_item --project-id P_board --field-id F_status --single-select-option-id O_prog"

  on_board=no
  run "a move of an issue off the board" 0 status 8 "done"
  said "a move of an issue off the board" "$calls" "project item-add 4"
  said "a move of an issue off the board" "$work/out" "#8 is Done"

  on_board=yes
  run "an unknown status" 1 status 7 doing
  said "an unknown status" "$work/err" "unknown status 'doing'"
  run "a number that is not one" 1 add seven
  run "the board URL" 0 url
  said "the board URL" "$work/out" "https://github.com/orgs/Example-Org/projects/4"

  projects='{"projects":[]}'
  run "no board" 1 add 7
  said "no board" "$work/err" "no project titled 'eduLIMS Roadmap'"

  local argument
  for argument in --help -h help --bogus "status 7" "add" "url extra" "show"; do
    # shellcheck disable=SC2086 # the case splits into its words on purpose
    run "the arguments '$argument'" 2 $argument
    said "the arguments '$argument'" "$work/err" "Usage:"
    [[ ! -s "$calls" ]] || die "self-test failed: the arguments '$argument' called gh"
  done
  run "no argument" 2

  rm -r "$work"
  echo "gh-project: self-test OK."
}

case "${1:-}" in
  --self-test) [[ $# -eq 1 ]] || usage; self_test; exit 0 ;;
  add | show) [[ $# -eq 2 ]] || usage ;;
  status) [[ $# -eq 3 ]] || usage ;;
  url) [[ $# -eq 1 ]] || usage ;;
  *) usage ;;
esac

need_int() {
  case "${1:-}" in
    '' | *[!0-9]*) die "expected an issue number, got '${1:-}'" ;;
    *) ;;
  esac
}

command -v gh >/dev/null 2>&1 || die "the GitHub CLI (gh) is not installed"
REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null)" ||
  die "could not resolve the current repository (run inside a gh-authenticated clone)"
OWNER="${REPO%%/*}"

PROJ_NUMBER="" PROJ_ID="" PROJ_URL=""
resolve_project() {
  [[ -n "$PROJ_ID" ]] && return 0
  local row
  row="$(gh project list --owner "$OWNER" --format json \
    --jq ".projects[] | select(.title == \"$TITLE\") | \"\(.number) \(.id) \(.url)\"" 2>/dev/null)" ||
    die "could not list the projects of $OWNER (missing 'project' scope? run: gh auth refresh -s project)"
  [[ -n "$row" ]] || die "no project titled '$TITLE' under $OWNER: create it first (see the header of this script)"
  read -r PROJ_NUMBER PROJ_ID PROJ_URL <<<"$row"
}

canonical_status() {
  case "$1" in
    todo) echo "Todo" ;;
    in-progress) echo "In Progress" ;;
    done) echo "Done" ;;
    *) die "unknown status '$1' (use todo, in-progress or done)" ;;
  esac
}

# The board item of issue n, read from the issue side, or "" when it has none.
item_id() {
  local n="$1"
  # shellcheck disable=SC2016 # $o/$r/$n are GraphQL variables, bound by the -f flags
  gh api graphql -f o="$OWNER" -f r="${REPO##*/}" -F n="$n" \
    -f query='query($o:String!,$r:String!,$n:Int!){ repository(owner:$o,name:$r){ issue(number:$n){ projectItems(first:20){ nodes{ id project{ id } } } } } }' \
    --jq ".data.repository.issue.projectItems.nodes[] | select(.project.id == \"$PROJ_ID\") | .id"
}

cmd_add() {
  local n="$1"
  need_int "$n"
  resolve_project
  gh project item-add "$PROJ_NUMBER" --owner "$OWNER" --url "https://github.com/$REPO/issues/$n" >/dev/null
  echo "ok: #$n is on the board"
}

cmd_status() {
  local n="$1" want field option item
  need_int "$n"
  want="$(canonical_status "$2")"
  resolve_project
  item="$(item_id "$n")"
  if [[ -z "$item" ]]; then
    cmd_add "$n" >/dev/null
    item="$(item_id "$n")"
    [[ -n "$item" ]] || die "could not place #$n on the board"
  fi
  field="$(gh project field-list "$PROJ_NUMBER" --owner "$OWNER" --format json \
    --jq '.fields[] | select(.name == "Status") | .id')"
  option="$(gh project field-list "$PROJ_NUMBER" --owner "$OWNER" --format json \
    --jq ".fields[] | select(.name == \"Status\") | .options[] | select(.name == \"$want\") | .id")"
  [[ -n "$field" && -n "$option" ]] || die "the board has no Status option named '$want'"
  gh project item-edit --id "$item" --project-id "$PROJ_ID" --field-id "$field" \
    --single-select-option-id "$option" >/dev/null
  echo "ok: #$n is $want"
}

cmd_show() {
  local n="$1" status
  need_int "$n"
  resolve_project
  status="$(gh project item-list "$PROJ_NUMBER" --owner "$OWNER" --limit 500 --format json \
    --jq ".items[] | select(.content.number == $n) | .status")"
  echo "#$n: ${status:-not on the board}"
}

case "$1" in
  add) cmd_add "$2" ;;
  status) cmd_status "$2" "$3" ;;
  show) cmd_show "$2" ;;
  url) resolve_project; echo "$PROJ_URL" ;;
esac
