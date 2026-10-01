"""Guards around the path filter.

  check-paths.py ancestry <paths.txt> <repo> <lineage.txt>
      Every listed path was touched in history, no rename moves an unlisted path into a listed one,
      and every move rename detection cannot see (a commit, or a merge against either parent, that
      adds a listed file while deleting a same-named unlisted one) is reviewed in <lineage.txt>.
      filter-repo does not follow renames, so a missed ancestor truncates history. Renames are
      paired down to 10% similarity; a move that keeps less than that under a new basename is
      indistinguishable from a new file and is not claimed.
  check-paths.py tree <paths.txt> <replace-text.txt> <tree-before.txt> <tree-after.txt> <freeze-dir>
      The filtered tip holds exactly the listed paths of the freeze tree, and each blob is the
      freeze blob with the replace rules applied, byte for byte.
"""

import hashlib
import os
import re
import subprocess
import sys

# Git's default 50% misses rewrite-heavy moves: contracts.yml became bridge-contracts.yml at 43%.
RENAMES = ["-c", "diff.renameLimit=100000", "log", "-m", "-M10%"]


def listed(paths_file):
    return [p.strip() for p in open(paths_file, encoding="utf-8") if p.strip()]


def covered(path, roots):
    return any(path == r or path.startswith(r + "/") for r in roots)


def git(repo, *args):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, check=True, text=True).stdout


def reviewed(lineage_file):
    pairs = set()
    for line in open(lineage_file, encoding="utf-8"):
        entry = line.split("#", 1)[0].strip()
        if entry:
            old, _, new = entry.partition(" -> ")
            pairs.add((old.strip(), new.strip()))
    return pairs


def hidden_moves(repo, roots):
    """(deleted unlisted, added listed) pairs sharing a basename within one diff, merges per parent.

    Rename detection stays on, so a detected rename is neither an addition nor a deletion here:
    only moves it could not pair are left.
    """
    log = git(repo, *RENAMES, "--name-status", "--format=%x00", "HEAD")
    pairs = set()
    for diff in log.split("\0"):
        added, deleted = {}, {}
        for line in diff.splitlines():
            status, _, path = line.partition("\t")
            if status == "A" and covered(path, roots):
                added.setdefault(os.path.basename(path), []).append(path)
            elif status == "D" and not covered(path, roots):
                deleted.setdefault(os.path.basename(path), []).append(path)
        for name in added.keys() & deleted.keys():
            pairs.update((old, new) for old in deleted[name] for new in added[name])
    return pairs


def ancestry(paths_file, repo, lineage_file):
    roots = listed(paths_file)
    touched = set(git(repo, "log", "-m", "--format=", "--name-only", "HEAD").splitlines())
    errors = [f"never touched in history: {r}" for r in roots if not any(covered(t, [r]) for t in touched)]
    renames = git(repo, *RENAMES, "--format=", "--name-status", "--diff-filter=R", "HEAD")
    for line in renames.splitlines():
        parts = line.split("\t")
        if len(parts) == 3 and covered(parts[2], roots) and not covered(parts[1], roots):
            errors.append(f"unlisted ancestor: {parts[1]} -> {parts[2]}")
    known = reviewed(lineage_file)
    moves = hidden_moves(repo, roots)
    errors += [f"unreviewed possible ancestor: {old} -> {new}" for old, new in sorted(moves - known)]
    errors += [f"lineage entry matches no diff: {old} -> {new}" for old, new in sorted(known - moves)]
    return errors


def replace_rules(replace_file):
    rules = []
    for line in open(replace_file, encoding="utf-8"):
        line = line.rstrip("\n")
        if not line:
            continue
        if not line.startswith("regex:") or "==>" not in line:
            raise ValueError(f"only regex:PATTERN==>REPLACEMENT rules are supported: {line}")
        pattern, _, replacement = line[len("regex:") :].partition("==>")
        rules.append((re.compile(pattern.encode()), replacement.encode()))
    return rules


def blob_oid(data):
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def tree_entries(tree_file):
    entries = {}
    for line in open(tree_file, encoding="utf-8"):
        meta, _, path = line.rstrip("\n").partition("\t")
        mode, kind, oid = meta.split()
        if kind == "blob":
            entries[path] = (mode, oid)
    return entries


def tree(paths_file, replace_file, before_file, after_file, freeze_dir):
    roots = listed(paths_file)
    rules = replace_rules(replace_file)
    before = {p: v for p, v in tree_entries(before_file).items() if covered(p, roots)}
    after = tree_entries(after_file)
    errors = [f"missing after filter: {p}" for p in sorted(set(before) - set(after))]
    errors += [f"unexpected after filter: {p}" for p in sorted(set(after) - set(before))]
    for path in sorted(set(before) & set(after)):
        with open(os.path.join(freeze_dir, path), "rb") as fh:
            data = fh.read()
        if blob_oid(data) != before[path][1]:
            errors.append(f"freeze tree disagrees with its commit: {path}")
            continue
        # filter-repo leaves binary blobs untouched.
        if b"\0" not in data[:8192]:
            for pattern, replacement in rules:
                data = pattern.sub(replacement, data)
        if (before[path][0], blob_oid(data)) != after[path]:
            errors.append(f"not the freeze blob with the replace rules applied: {path}")
    return errors


def main():
    mode, *args = sys.argv[1:]
    errors = ancestry(*args) if mode == "ancestry" else tree(*args)
    for e in errors:
        print(f"check-paths: {e}", file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
