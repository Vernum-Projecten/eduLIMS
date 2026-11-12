---
name: clean-up-worktrees
description: Remove a worktree and its local branches as soon as its PR merges or its agent finishes; never leave them under .claude/worktrees
metadata:
  type: feedback
---

Remove every worktree under `.claude/worktrees/` as soon as its PR merges
(or closes) or its agent finishes, together with its local branch and the
harness's `worktree-agent-*` base branch. Check first: no uncommitted change,
the branch merged or superseded, and any `.claude/agent-memory/` notes copied
into the main checkout. Use `git worktree remove` (`-f -f` for a finished
agent's harness lock), never a recursive delete of the directory; keep the
worktree of an agent that is still running.

**Why:** the owner found 60 stale worktrees and 59 stale branches after one
day of parallel work (2026-11-12); they cost disk space and hide which work is
live.

**How to apply:** after each merge the PR watcher reports, and after each
agent hand-back, remove that worktree and its branches in the same turn, and
pull the owner's checkout. See [[run-commands-yourself]].
