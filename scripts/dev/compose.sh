#!/usr/bin/env bash
# SPDX-FileCopyrightText: Ruben Talstra
# SPDX-License-Identifier: Apache-2.0
# The development stack of compose.dev.yaml (PostgreSQL 18 with the eduLIMS,
# test and e2e databases, and Keycloak), through `podman compose` when podman
# is on PATH and `docker compose` otherwise. Every argument goes to compose.
#
# The stack runs from the main checkout only. A linked git worktree has the
# same Compose project name but other bind-mount paths, so `up` there
# recreates the containers of the main checkout. In a worktree, `up`, `down`,
# `stop` and `restart` are refused; tests there use the running stack as it is.
#
# Usage:
#   scripts/dev/compose.sh <compose arguments>
#   scripts/dev/compose.sh up -d --wait     # pnpm dev:db: start and wait until healthy
#   scripts/dev/compose.sh down             # pnpm dev:db:stop: stop, keep the data volume
#   scripts/dev/compose.sh logs -f          # pnpm dev:db:logs: follow the logs
#   scripts/dev/compose.sh --allow-worktree up -d --wait   # deliberately, from a worktree
#   scripts/dev/compose.sh --self-test
#   scripts/dev/compose.sh --help
#
# EDULIMS_CONTAINER_ENGINE=docker (or podman) picks the engine explicitly.
set -euo pipefail

usage() {
  awk '/^# Usage:/ { on = 1 } /^set / { on = 0 } on { sub(/^# ?/, ""); print }' "$0"
}

# True when directory $1 is inside a linked worktree, not the main checkout.
is_linked_worktree() {
  local git_dir common_dir
  git_dir=$(git -C "$1" rev-parse --path-format=absolute --git-dir 2>/dev/null) || return 1
  common_dir=$(git -C "$1" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || return 1
  [[ "$git_dir" != "$common_dir" ]]
}

# Prints the first argument that starts or stops containers. Any position counts, because a
# global option such as `--project-directory .` takes a value that looks like a command.
lifecycle_command() {
  local argument
  for argument in "$@"; do
    case "$argument" in
      up | down | stop | restart)
        printf '%s\n' "$argument"
        return 0
        ;;
    esac
  done
}

# Exits 0 when compose may run `$@` from directory $1, else explains and exits 1.
check_worktree() {
  local dir=$1 command
  shift
  command=$(lifecycle_command "$@")
  [[ -n "$command" ]] || return 0
  is_linked_worktree "$dir" || return 0
  {
    echo "error: the dev stack runs only from the main checkout, and this is a git worktree."
    echo "Running '${command}' here would recreate the stack of the main checkout."
    echo "Tests in a worktree use the running stack as it is. Start or stop it from the main"
    echo "checkout, or pass --allow-worktree first if you mean it."
  } >&2
  return 1
}

self_test() {
  local work
  work=$(mktemp -d)
  trap 'rm -rf "$work"' RETURN
  git -C "$work" init -q main
  git -C "$work/main" -c user.name=t -c user.email=t@example.test commit -q --allow-empty -m init
  git -C "$work/main" worktree add -q "$work/linked" -b linked

  check_worktree "$work/main" up -d --wait 2> /dev/null ||
    { echo "self-test: up refused in the main checkout" >&2; return 1; }
  for command in up down stop restart; do
    check_worktree "$work/linked" "$command" 2> "$work/err" &&
      { echo "self-test: $command allowed in a worktree" >&2; return 1; }
    grep -q "only from the main checkout" "$work/err" ||
      { echo "self-test: no explanation for $command in a worktree" >&2; return 1; }
  done
  check_worktree "$work/linked" --project-directory . up -d 2> /dev/null &&
    { echo "self-test: up after a global option allowed in a worktree" >&2; return 1; }
  check_worktree "$work/linked" logs -f 2> /dev/null ||
    { echo "self-test: logs refused in a worktree" >&2; return 1; }
  check_worktree "$work/linked" ps 2> /dev/null ||
    { echo "self-test: ps refused in a worktree" >&2; return 1; }
  check_worktree "$work" up 2> /dev/null ||
    { echo "self-test: up refused outside any git checkout" >&2; return 1; }
  echo "compose: self-test passed"
}

if [[ $# -eq 0 ]]; then
  usage >&2
  exit 2
fi
case "$1" in
  --help | -h)
    usage
    exit 0
    ;;
  --self-test)
    self_test
    exit $?
    ;;
esac

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [[ "$1" == "--allow-worktree" ]]; then
  shift
  [[ $# -gt 0 ]] || { usage >&2; exit 2; }
else
  check_worktree "$root" "$@" || exit 1
fi

engine="${EDULIMS_CONTAINER_ENGINE:-}"
if [[ -z "$engine" ]]; then
  if command -v podman >/dev/null 2>&1; then
    engine=podman
  elif command -v docker >/dev/null 2>&1; then
    engine=docker
  else
    echo "error: neither podman nor docker is on PATH; install Podman (or Docker) with Compose." >&2
    exit 1
  fi
fi
case "$engine" in
  podman | docker) ;;
  *)
    echo "error: EDULIMS_CONTAINER_ENGINE must be podman or docker, not '${engine}'." >&2
    exit 2
    ;;
esac

exec "$engine" compose -f "${root}/compose.dev.yaml" "$@"
