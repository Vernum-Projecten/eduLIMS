#!/usr/bin/env bash
# SPDX-FileCopyrightText: Ruben Talstra
# SPDX-License-Identifier: Apache-2.0
# scripts/gh/repo-settings.sh: apply the repository configuration that
# docs/ci-cd.md describes, through the REST API.
#
# Every call sets a value to a fixed state (PATCH, PUT, or a ruleset updated in
# place by name), so a second run changes nothing. It applies:
#   * merging: squash only, the pull-request title and body as the commit,
#     auto-merge on, the head branch deleted on merge;
#   * the `main` ruleset: a pull request with 0 required approvals, the one
#     required check `conclusion` from GitHub Actions, the merge queue
#     (squash, all-green grouping), linear history, signed commits, and no
#     force push or deletion;
#   * the `release-tags` ruleset: a `v*` tag is never moved or deleted;
#   * security: secret scanning with push protection, Dependabot alerts and
#     security updates, private vulnerability reporting, and the CodeQL
#     default setup off (codeql.yml is the advanced setup);
#   * Actions: a read-only default GITHUB_TOKEN that may not approve pull
#     requests, and actions pinned to a full commit SHA;
#   * immutable releases.
# A setting the plan or the API does not offer is reported as `skipped` with
# the API's answer, and the run goes on.
#
# The token needs admin rights on the repository.
# Official docs:
#   Repositories ...... https://docs.github.com/en/rest/repos/repos#update-a-repository
#   Rulesets .......... https://docs.github.com/en/rest/repos/rules
#   Available rules ... https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
#   Actions settings .. https://docs.github.com/en/rest/actions/permissions
#
# Usage:
#   scripts/gh/repo-settings.sh [--dry-run] [--repo <owner/name>]
#       Applies the settings to the repository (default: `gh repo view`).
#       --dry-run prints every call and its payload and changes nothing.
#   scripts/gh/repo-settings.sh --self-test
#       Drives this program against a stub gh on PATH: a dry run writes
#       nothing, a ruleset that exists is updated in place and one that does
#       not is created, a refused optional setting is skipped, a refused
#       required one fails the run, and every usage error touches nothing.
#   Any other argument, --help included, prints this usage and exits 2.

set -euo pipefail

# The app id of GitHub Actions: the required check counts only a `conclusion`
# that Actions reports, so no other app can satisfy it.
readonly ACTIONS_APP_ID=15368

die() {
  echo "repo-settings: $*" >&2
  exit 1
}

usage() {
  sed -n '/^# Usage:/,/^$/p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

DRY=0
REPO=""

# api <required|optional> <METHOD> <path> [json]: one call, printed in a dry
# run. An optional call that GitHub refuses is reported and skipped.
api() {
  local need=$1 method=$2 path=$3 body=${4:-} out
  if [[ "$DRY" -eq 1 ]]; then
    echo "would: $method $path"
    [[ -z "$body" ]] || jq . <<<"$body" | sed 's/^/    /'
    return 0
  fi
  if [[ -n "$body" ]]; then
    out="$(gh api --method "$method" "$path" --input - <<<"$body" 2>&1)" && { echo "ok: $method $path"; return 0; }
  else
    out="$(gh api --method "$method" "$path" </dev/null 2>&1)" && { echo "ok: $method $path"; return 0; }
  fi
  if [[ "$need" == optional ]]; then
    echo "skipped: $method $path ($(head -c 200 <<<"$out" | tr '\n' ' '))"
    return 0
  fi
  echo "$out" >&2
  die "$method $path failed"
}

# ruleset <name> <json>: update the ruleset of that name in place, or create it.
ruleset() {
  local name=$1 body=$2 id
  id="$(gh api "repos/$REPO/rulesets?includes_parents=false" --jq ".[] | select(.name == \"$name\") | .id" </dev/null)" ||
    die "could not list the rulesets of $REPO"
  if [[ -n "$id" ]]; then
    api required PUT "repos/$REPO/rulesets/$id" "$body"
  else
    api required POST "repos/$REPO/rulesets" "$body"
  fi
}

apply() {
  echo "== merging =="
  api required PATCH "repos/$REPO" '{
    "allow_squash_merge": true,
    "allow_merge_commit": false,
    "allow_rebase_merge": false,
    "allow_auto_merge": true,
    "allow_update_branch": true,
    "delete_branch_on_merge": true,
    "squash_merge_commit_title": "PR_TITLE",
    "squash_merge_commit_message": "PR_BODY"
  }'

  echo "== security =="
  api optional PATCH "repos/$REPO" '{
    "security_and_analysis": {
      "secret_scanning": { "status": "enabled" },
      "secret_scanning_push_protection": { "status": "enabled" },
      "secret_scanning_non_provider_patterns": { "status": "enabled" },
      "secret_scanning_validity_checks": { "status": "enabled" }
    }
  }'
  api required PUT "repos/$REPO/vulnerability-alerts"
  api required PUT "repos/$REPO/automated-security-fixes"
  api optional PUT "repos/$REPO/private-vulnerability-reporting"
  api optional PATCH "repos/$REPO/code-scanning/default-setup" '{ "state": "not-configured" }'
  api optional PUT "repos/$REPO/immutable-releases"

  echo "== actions =="
  api required PUT "repos/$REPO/actions/permissions/workflow" '{
    "default_workflow_permissions": "read",
    "can_approve_pull_request_reviews": false
  }'
  api optional PUT "repos/$REPO/actions/permissions" '{
    "enabled": true,
    "allowed_actions": "all",
    "sha_pinning_required": true
  }'

  echo "== rulesets =="
  ruleset main "$(cat <<JSON
{
  "name": "main",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "required_linear_history" },
    { "type": "required_signatures" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false,
        "allowed_merge_methods": ["squash"]
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "do_not_enforce_on_create": false,
        "required_status_checks": [
          { "context": "conclusion", "integration_id": ${ACTIONS_APP_ID} }
        ]
      }
    },
    {
      "type": "merge_queue",
      "parameters": {
        "merge_method": "SQUASH",
        "grouping_strategy": "ALLGREEN",
        "max_entries_to_build": 5,
        "min_entries_to_merge": 1,
        "max_entries_to_merge": 5,
        "min_entries_to_merge_wait_minutes": 0,
        "check_response_timeout_minutes": 60
      }
    }
  ]
}
JSON
)"
  ruleset release-tags '{
    "name": "release-tags",
    "target": "tag",
    "enforcement": "active",
    "bypass_actors": [],
    "conditions": { "ref_name": { "include": ["refs/tags/v*"], "exclude": [] } },
    "rules": [
      { "type": "deletion" },
      { "type": "update" },
      { "type": "non_fast_forward" }
    ]
  }'

  if [[ "$DRY" -eq 1 ]]; then
    echo "dry run: nothing changed."
  else
    echo "done."
  fi
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
# The gh a self-test run of scripts/gh/repo-settings.sh speaks to. It logs
# every call with its method, lists the rulesets the test says exist, and
# refuses the path the test names.
set -euo pipefail
method=GET
path=""
filter=""
previous=""
for argument in "$@"; do
  [[ "$previous" == "--method" ]] && method="$argument"
  [[ "$previous" == "--jq" ]] && filter="$argument"
  [[ "$argument" == repos/* ]] && path="$argument"
  previous="$argument"
done
case "${1:-} ${2:-}" in
  "repo view") echo "Example-Org/Example"; exit 0 ;;
esac
printf '%s %s\n' "$method" "$path" >> "$GH_STUB_CALLS"
if [[ -n "${GH_STUB_REFUSE:-}" && "$path" == "$GH_STUB_REFUSE" ]]; then
  echo '{"message":"Not available on this plan"}'
  exit 1
fi
if [[ "$method" == GET && "$path" == *"/rulesets?"* ]]; then
  printf '%s' "$GH_STUB_RULESETS" | jq -r "$filter"
fi
STUB
  chmod 0755 "$stub/gh"

  local rc rulesets refuse
  run() {
    local name=$1 code=$2
    shift 2
    rc=0
    : > "$calls"
    PATH="$stub:$PATH" GH_STUB_CALLS="$calls" GH_STUB_RULESETS="$rulesets" \
      GH_STUB_REFUSE="$refuse" bash "$0" "$@" > "$work/out" 2> "$work/err" || rc=$?
    if [[ "$rc" -ne "$code" ]]; then
      echo "repo-settings: self-test failed: $name exited $rc, wanted $code." >&2
      cat "$work/out" "$work/err" "$calls" >&2
      exit 1
    fi
  }
  said() {
    grep -qF -- "$3" "$2" || {
      echo "repo-settings: self-test failed: $1 did not say '$3'." >&2
      cat "$work/out" "$work/err" "$calls" >&2
      exit 1
    }
  }
  never() {
    if grep -qF -- "$3" "$2"; then
      echo "repo-settings: self-test failed: $1 said '$3'." >&2
      cat "$work/out" "$work/err" "$calls" >&2
      exit 1
    fi
  }

  rulesets='[{"id":11,"name":"main"}]'
  refuse=""
  run "a dry run" 0 --dry-run --repo Example-Org/Example
  said "a dry run" "$work/out" "would: PUT repos/Example-Org/Example/rulesets/11"
  said "a dry run" "$work/out" "would: POST repos/Example-Org/Example/rulesets"
  said "a dry run" "$work/out" '"context": "conclusion"'
  said "a dry run" "$work/out" "dry run: nothing changed."
  never "a dry run" "$calls" "PUT "
  never "a dry run" "$calls" "PATCH "
  never "a dry run" "$calls" "POST "

  run "an apply" 0
  said "an apply" "$calls" "PATCH repos/Example-Org/Example"
  said "an apply" "$calls" "PUT repos/Example-Org/Example/rulesets/11"
  said "an apply" "$calls" "POST repos/Example-Org/Example/rulesets"
  said "an apply" "$calls" "PUT repos/Example-Org/Example/private-vulnerability-reporting"
  said "an apply" "$work/out" "done."

  refuse="repos/Example-Org/Example/immutable-releases"
  run "a refused optional setting" 0
  said "a refused optional setting" "$work/out" "skipped: PUT repos/Example-Org/Example/immutable-releases"
  said "a refused optional setting" "$work/out" "done."

  refuse="repos/Example-Org/Example/vulnerability-alerts"
  run "a refused required setting" 1
  never "a refused required setting" "$work/out" "done."

  refuse=""
  local argument
  for argument in --help -h --bogus "--repo" "--repo bad" "--self-test --dry-run"; do
    # shellcheck disable=SC2086 # the case splits into its words on purpose
    run "the arguments '$argument'" 2 $argument
    said "the arguments '$argument'" "$work/err" "Usage:"
    [[ ! -s "$calls" ]] || die "self-test failed: the arguments '$argument' called gh"
  done

  rm -r "$work"
  echo "repo-settings: self-test OK."
}

if [[ "$#" -eq 1 && "$1" == "--self-test" ]]; then
  self_test
  exit 0
fi

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY=1; shift ;;
    --repo)
      [[ "$#" -ge 2 && "$2" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || usage
      REPO="$2"
      shift 2
      ;;
    *) usage ;;
  esac
done

command -v gh >/dev/null 2>&1 || die "the GitHub CLI (gh) is not installed"
command -v jq >/dev/null 2>&1 || die "jq is not installed"
if [[ -z "$REPO" ]]; then
  REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null)" ||
    die "could not resolve the current repository (pass --repo <owner/name>)"
fi
apply
