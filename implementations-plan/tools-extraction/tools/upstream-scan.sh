#!/usr/bin/env bash
# Fails when any object reachable from HEAD names nulo's upstream. Every commit (its message), tree
# (its entry names) and blob (symlink targets included, which a tree-mode `git grep` skips) is read
# as raw bytes. Text stored as UTF-16 still escapes a byte pattern; the audit's binary-fingerprint
# gate is what covers new binaries.
#
#   upstream-scan.sh <repo>     exit 0 clean, 1 a match, 2 the scan itself failed
set -uo pipefail

repo=${1:?usage: upstream-scan.sh <repo>}
upstream='azguard|bb strategy'
count=$(mktemp)
trap 'rm -f "$count"' EXIT

# `grep -c` reads to the end, so nothing upstream of it is cut off by a SIGPIPE; each stage's
# status is then checked on its own.
git -C "$repo" rev-list --objects HEAD | cut -d' ' -f1 | git -C "$repo" cat-file --batch | grep -aicE "$upstream" >"$count"
status=("${PIPESTATUS[@]}")
if [ "${status[0]}${status[1]}${status[2]}" != 000 ] || [ "${status[3]}" -gt 1 ]; then
  echo "upstream-scan: the scan failed (statuses ${status[*]})" >&2
  exit 2
fi
if [ "$(cat "$count")" != 0 ]; then
  echo "upstream-scan: $(cat "$count") line(s) reachable from HEAD name nulo's upstream" >&2
  exit 1
fi
echo "upstream-scan: no object reachable from HEAD names nulo's upstream"
