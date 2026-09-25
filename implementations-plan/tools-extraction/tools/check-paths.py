"""Guards around the path filter.

  check-paths.py ancestry <paths.txt> <renames.txt> <touched.txt>
      Every listed path was touched in history, and no rename moves an unlisted path into a listed
      one: filter-repo does not follow renames, so a missing ancestor silently truncates history.
  check-paths.py tree <paths.txt> <tree-before.txt> <tree-after.txt> <freeze-dir>
      The filtered tip holds exactly the listed paths of the freeze tree, byte-identical except the
      files whose absolute paths --replace-text normalised.
"""

import re
import sys

ABS_PATH = re.compile(rb"/Users/[A-Za-z]|/home/[A-Za-z]|/mnt/user-data/[A-Za-z]")


def listed(paths_file):
    return [p.strip() for p in open(paths_file, encoding="utf-8") if p.strip()]


def covered(path, roots):
    return any(path == r or path.startswith(r + "/") for r in roots)


def ancestry(paths_file, renames_file, touched_file):
    roots = listed(paths_file)
    touched = [p.rstrip("\n") for p in open(touched_file, encoding="utf-8") if p.strip()]
    errors = [f"never touched in history: {r}" for r in roots if not any(covered(t, [r]) for t in touched)]
    for line in open(renames_file, encoding="utf-8"):
        parts = line.rstrip("\n").split("\t")
        if len(parts) == 3 and parts[0].startswith("R") and covered(parts[2], roots) and not covered(parts[1], roots):
            errors.append(f"unlisted ancestor: {parts[1]} -> {parts[2]}")
    return errors


def tree_entries(tree_file):
    entries = {}
    for line in open(tree_file, encoding="utf-8"):
        meta, _, path = line.rstrip("\n").partition("\t")
        mode, kind, oid = meta.split()
        if kind == "blob":
            entries[path] = (mode, oid)
    return entries


def tree(paths_file, before_file, after_file, freeze_dir):
    roots = listed(paths_file)
    before = {p: v for p, v in tree_entries(before_file).items() if covered(p, roots)}
    after = tree_entries(after_file)
    errors = [f"missing after filter: {p}" for p in sorted(set(before) - set(after))]
    errors += [f"unexpected after filter: {p}" for p in sorted(set(after) - set(before))]
    for path in sorted(set(before) & set(after)):
        if before[path][0] != after[path][0]:
            errors.append(f"mode changed: {path}")
        elif before[path][1] != after[path][1]:
            with open(f"{freeze_dir}/{path}", "rb") as fh:
                data = fh.read()
            if b"\0" in data[:8192] or not ABS_PATH.search(data):
                errors.append(f"content changed without an absolute path to normalise: {path}")
    return errors


def main():
    mode, *args = sys.argv[1:]
    errors = ancestry(*args) if mode == "ancestry" else tree(*args)
    for e in errors:
        print(f"check-paths: {e}", file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
