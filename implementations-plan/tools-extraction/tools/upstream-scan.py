#!/usr/bin/env python3
"""Fails when any object reachable from HEAD names nulo's upstream.

Every commit (its message), tree (its entry names) and blob (symlink targets included, which a
tree-mode `git grep` skips) is read as raw bytes, as a push would send it: replacement refs are
ignored, and a repository with grafts or a shallow boundary is refused, since either can hide
ancestry from the traversal. Each `cat-file --batch` record is parsed by its header and exact
length, so an object that is missing when read fails the scan. Text stored as UTF-16 still escapes a
byte pattern; the audit's binary-fingerprint gate is what covers new binaries.

    upstream-scan.py <repo>     exit 0 clean, 1 a match, 2 the scan could not vouch for the history
"""
import os
import re
import subprocess
import sys
import threading

UPSTREAM = re.compile(rb"azguard|bb strategy", re.IGNORECASE)


def refuse(message: str) -> None:
    print(f"upstream-scan: {message}", file=sys.stderr)
    sys.exit(2)


def main() -> None:
    if len(sys.argv) != 2:
        refuse("usage: upstream-scan.py <repo>")
    repo = sys.argv[1]
    env = {k: v for k, v in os.environ.items() if k not in ("GIT_GRAFT_FILE", "GIT_REPLACE_REF_BASE")}
    env["GIT_NO_REPLACE_OBJECTS"] = "1"

    def git(*args: str) -> bytes:
        run = subprocess.run(["git", "-C", repo, *args], env=env, capture_output=True)
        if run.returncode != 0:
            refuse(f"git {' '.join(args)} failed: {run.stderr.decode(errors='replace').strip()}")
        return run.stdout

    if git("rev-parse", "--is-shallow-repository").strip() != b"false":
        refuse("the repository is shallow")
    if os.path.exists(git("rev-parse", "--path-format=absolute", "--git-path", "info/grafts").strip().decode()):
        refuse("the repository has grafts")

    oids = git("rev-list", "--objects", "--no-object-names", "HEAD").split()
    if not oids:
        refuse("HEAD reaches no objects")

    batch = subprocess.Popen(["git", "-C", repo, "cat-file", "--batch"], env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE)

    def feed() -> None:
        batch.stdin.write(b"".join(oid + b"\n" for oid in oids))
        batch.stdin.close()

    threading.Thread(target=feed, daemon=True).start()
    hits = 0
    for oid in oids:
        header = batch.stdout.readline().split()
        if len(header) != 3 or header[0] != oid:
            refuse(f"no object record for {oid.decode()}: {b' '.join(header).decode(errors='replace')}")
        size = int(header[2])
        body = batch.stdout.read(size + 1)
        if len(body) != size + 1 or not body.endswith(b"\n"):
            refuse(f"truncated record for {oid.decode()}")
        hits += len(UPSTREAM.findall(body[:size]))
    if batch.stdout.read(1) or batch.wait() != 0:
        refuse("cat-file did not end cleanly")

    if hits:
        print(f"upstream-scan: {hits} match(es) in objects reachable from HEAD name nulo's upstream", file=sys.stderr)
        sys.exit(1)
    print(f"upstream-scan: none of the {len(oids)} objects reachable from HEAD names nulo's upstream")


if __name__ == "__main__":
    main()
