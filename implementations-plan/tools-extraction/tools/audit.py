"""Pre-push audit of an extracted history: secrets, absolute paths, filenames, identities, binaries.

Usage: audit.py <repo> <report-dir> <allowlist> [<allowlist> ...]

Every reachable text blob and every commit message is written to a scratch file and scanned there,
which covers content a merge resolution introduced as well as anything a diff would show. Each file
ends in a canary unique to it, and each scanner must report every file's canary, so a file a scanner
skipped or stopped short in fails the audit. Inline suppressions are disarmed first. A binary blob
cannot be scanned and must be allowlisted by fingerprint. A finding is keyed by the SHA-256 of its
value and reported only by location, so no candidate secret reaches the report. Exits 1 on an
untriaged finding, an unused allowlist entry, a scanner error or an incomplete scan.
"""

import collections
import hashlib
import json
import os
import re
import string
import subprocess
import sys
import tempfile
import threading

SCANNERS = {"gitleaks": ["gitleaks", "version"], "trufflehog": ["trufflehog", "--version"]}
VERSIONS = {"gitleaks": "8.30.1", "trufflehog": "3.97.4"}
ABS_PATH = re.compile(
    rb"/Users/[A-Za-z0-9_]|/home/[A-Za-z0-9_]|/mnt/user-data/[A-Za-z0-9_]|(?<![\w./-])/root/|[A-Za-z]:(?:\\)+Users(?:\\)+"
)
BARE_ISSUE_REF = re.compile(rb"(?<![\w/#&])#\d+\b")
SENSITIVE_NAME = re.compile(r"(^|/)\.env($|\.)|\.pem$|keystore|key", re.IGNORECASE)
OID = re.compile(r"[0-9a-f]{40}")
# trufflehog has no switch to stop honouring its inline marker; the canary line carries gitleaks'
# marker to prove --ignore-gitleaks-allow on every file.
TRUFFLEHOG_SUPPRESSION = re.compile(rb"trufflehog:ignore", re.IGNORECASE)
CANARY_SUFFIX = b" gitleaks:allow"
# trufflehog stops reading a line past 10 MiB without reporting it.
MAX_LINE = 10 * 1024 * 1024
# Vowel-free, so a canary rarely contains a word trufflehog's unverified-result filter drops.
CANARY_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ" + string.digits


def git(repo, *args, data=None):
    return subprocess.run(["git", "-C", repo, *args], input=data, capture_output=True, check=True).stdout


def load_allowlist(paths):
    keys = set()
    for path in paths:
        for line in open(path, encoding="utf-8"):
            entry = line.split("#", 1)[0].strip()
            if entry:
                keys.add(entry)
    return keys


def canary(seed):
    """A GitHub-token-shaped string both scanners report; one in a few thousand still trips the word filter."""
    n = int.from_bytes(hashlib.sha256(b"audit-canary:" + seed).digest(), "big")
    body = ""
    for _ in range(36):
        n, r = divmod(n, len(CANARY_ALPHABET))
        body += CANARY_ALPHABET[r]
    return "ghp_" + body


def reachable_blobs(repo):
    first_path = {}
    for line in git(repo, "rev-list", "--objects", "--all").decode().splitlines():
        oid, _, path = line.partition(" ")
        first_path.setdefault(oid, path)
    checks = git(repo, "cat-file", "--batch-check=%(objecttype) %(objectname)", data="\n".join(first_path).encode())
    return [(line.split()[1], first_path[line.split()[1]]) for line in checks.decode().splitlines() if line.startswith("blob ")]


def objects(repo, oids):
    proc = subprocess.Popen(["git", "-C", repo, "cat-file", "--batch"], stdin=subprocess.PIPE, stdout=subprocess.PIPE)

    def feed():
        proc.stdin.write(("\n".join(oids) + "\n").encode())
        proc.stdin.close()

    # Fed from a thread: writing every id before reading deadlocks once both pipe buffers fill.
    writer = threading.Thread(target=feed)
    writer.start()
    for _ in oids:
        header = proc.stdout.readline().split()
        data = proc.stdout.read(int(header[2]))
        proc.stdout.read(1)
        yield header[0].decode(), data
    writer.join()
    if proc.wait() != 0:
        raise RuntimeError("git cat-file --batch failed")


def commit_messages(repo):
    oids = git(repo, "rev-list", "--all").decode().split()
    if not all(OID.fullmatch(oid) for oid in oids):
        raise RuntimeError("git rev-list printed something other than commit ids")
    for oid, raw in objects(repo, oids):
        # Headers end at the first blank line; signature continuation lines are never empty.
        yield oid, raw.partition(b"\n\n")[2]


class Audit:
    def __init__(self, allow):
        self.allow = allow
        self.used = set()
        self.untriaged = {}
        self.failures = []

    def check(self, key, where):
        if key in self.allow:
            self.used.add(key)
        else:
            self.untriaged.setdefault(key, where)

    def fail(self, reason):
        self.failures.append(reason)


def write_framed(target, data, token, lead=b""):
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, "wb") as fh:
        fh.write(lead + data + b"\n" + token.encode() + CANARY_SUFFIX + b"\n")


class ScanSet:
    """Files written under one root, each ending in its own canary."""

    def __init__(self, root):
        self.root = root
        self.files = {}

    def add(self, rel, data, label, where):
        target = os.path.normpath(os.path.join(self.root, rel))
        if not target.startswith(self.root + os.sep) or rel in self.files:
            raise RuntimeError(f"unsafe or repeated scratch path for {where}")
        token = canary(b"%d" % len(self.files))
        write_framed(target, TRUFFLEHOG_SUPPRESSION.sub(b"trufflehog-ignore", data), token)
        self.files[rel] = (label, where, token)

    def content(self, rel):
        with open(os.path.join(self.root, rel), "rb") as fh:
            framed = fh.read()
        return framed[: -len(self.files[rel][2]) - len(CANARY_SUFFIX) - 2]


def materialize(repo, blobs_set, audit):
    """Writes every text blob to <root>/<n>/<path>; records binaries, long lines and absolute paths."""
    blobs = reachable_blobs(repo)
    where = dict(blobs)
    text = 0
    for oid, data in objects(repo, [oid for oid, _ in blobs]):
        path = where[oid]
        if ABS_PATH.search(data):
            audit.check(f"abspath:{path}:{oid[:12]}", f"blob {oid[:12]}")
        if b"\0" in data[:8192]:
            # Keyed by content alone: the same bytes may sit at several paths, and which one
            # rev-list names first depends on the refs scanned.
            audit.check(f"binary:{oid[:12]}", f"{path} (blob {oid[:12]}), not scannable")
            continue
        if max((len(line) for line in data.split(b"\n")), default=0) > MAX_LINE:
            audit.fail(f"{path} (blob {oid[:12]}) has a line over {MAX_LINE} bytes, which trufflehog truncates")
        blobs_set.add(os.path.join(str(len(blobs_set.files)), path), data, path, f"blob {oid[:12]}")
        text += len(data)
    return len(blobs), text


def scanner_env():
    return {k: v for k, v in os.environ.items() if not k.upper().startswith(("GITLEAKS", "TRUFFLEHOG"))}


def check_versions():
    for name, cmd in SCANNERS.items():
        proc = subprocess.run(cmd, capture_output=True, text=True, env=scanner_env())
        if proc.returncode != 0 or VERSIONS[name] not in (proc.stdout + proc.stderr).split():
            raise RuntimeError(f"{name} is not version {VERSIONS[name]}")


def run_gitleaks(target, label, pinned):
    """Default rules only: no config, ignore file or inline allow can come from the scanned tree or the environment."""
    proc = subprocess.run(
        [
            "gitleaks", "dir", target, "--no-banner", "--exit-code", "0", "--config", pinned["config"],
            "--gitleaks-ignore-path", pinned["cwd"], "--ignore-gitleaks-allow",
            "--report-format", "json", "--report-path", "-",
        ],
        capture_output=True,
        cwd=pinned["cwd"],
        env=scanner_env(),
    )
    if proc.returncode != 0:
        raise RuntimeError(f"gitleaks ({label}) exited {proc.returncode}")
    findings = json.loads(proc.stdout)
    if not isinstance(findings, list):
        raise RuntimeError(f"gitleaks ({label}) did not report a JSON array")
    return [(f["RuleID"], f["File"], int(f["StartLine"]), f["Secret"]) for f in findings]


def run_trufflehog(target, label, pinned):
    proc = subprocess.run(
        ["trufflehog", "filesystem", target, "--no-verification", "--json", "--no-update", "--fail-on-scan-errors"],
        capture_output=True,
        cwd=pinned["cwd"],
        env=scanner_env(),
    )
    if proc.returncode != 0:
        raise RuntimeError(f"trufflehog ({label}) exited {proc.returncode}")
    findings = []
    for line in proc.stdout.decode().splitlines():
        if not line.strip():
            continue
        result = json.loads(line)
        meta = result["SourceMetadata"]["Data"]["Filesystem"]
        findings.append((result["DetectorName"], meta["file"], int(meta.get("line", 0)), result["Raw"]))
    return findings


RUNNERS = {"gitleaks": run_gitleaks, "trufflehog": run_trufflehog}


def triage(audit, scanner, findings, root, scan_set, owner, shift=0):
    """Records findings; returns the files whose canary came back. <owner> maps a scanned name to (file, canary)."""
    seen = set()
    for rule, file, line, secret in findings:
        owned = owner(os.path.relpath(file, root))
        if owned is None:
            audit.fail(f"{scanner} reported a file outside the scan set")
            continue
        rel, token = owned
        if token in secret:
            seen.add(rel)
            continue
        path, where, _ = scan_set.files[rel]
        digest = hashlib.sha256(secret.encode()).hexdigest()[:16]
        audit.check(f"secret:{scanner}:{rule}:{path}:{digest}", f"{where} line {line - shift}")
    return seen


def scan(audit, label, scan_set, scratch, pinned):
    """Both scanners over one scan set; every file's canary must come back from each.

    A file whose canary is missing is scanned once more as plain text: under a bare number, after a
    neutral first line, with a fresh canary. gitleaks' default config skips images, lockfiles,
    vendored trees and more by path, trufflehog skips content it sniffs as an image (SVG), and a
    canary can still trip trufflehog's word filter. A file a scanner cannot read misses both times.
    """
    def in_place(rel):
        return (rel, scan_set.files[rel][2]) if rel in scan_set.files else None

    counts = []
    for scanner, run in RUNNERS.items():
        first = triage(audit, scanner, run(scan_set.root, label, pinned), scan_set.root, scan_set, in_place)
        retry = sorted(set(scan_set.files) - first)
        retry_root = os.path.join(scratch, f"{label}-{scanner}-retry")
        tokens = [canary(b"retry:%d" % n) for n in range(len(retry))]
        for n, rel in enumerate(retry):
            write_framed(os.path.join(retry_root, str(n)), scan_set.content(rel), tokens[n], lead=b"audit retry\n")

        def numbered(name):
            return (retry[int(name)], tokens[int(name)]) if name.isdigit() and int(name) < len(retry) else None

        second = set()
        if retry:
            findings = run(retry_root, f"{label} retry", pinned)
            second = triage(audit, scanner, findings, retry_root, scan_set, numbered, shift=1)
        for rel in sorted(set(retry) - second):
            audit.fail(f"{scanner} ({label}) never reached the end of {scan_set.files[rel][1]}")
        counts.append(f"{scanner}: {len(first) + len(second)} of {len(scan_set.files)} files read to their canary, {len(retry)} on a retry")
    return counts


def scan_contents(repo, audit):
    with tempfile.TemporaryDirectory() as scratch:
        pinned = {"config": os.path.join(scratch, "gitleaks.toml"), "cwd": os.path.join(scratch, "cwd")}
        os.makedirs(pinned["cwd"])
        with open(pinned["config"], "w", encoding="utf-8") as fh:
            fh.write("[extend]\nuseDefault = true\n")
        blob_set, msg_set = ScanSet(os.path.join(scratch, "blobs")), ScanSet(os.path.join(scratch, "messages"))
        nblobs, text = materialize(repo, blob_set, audit)
        for oid, body in commit_messages(repo):
            if ABS_PATH.search(body) or BARE_ISSUE_REF.search(body):
                audit.fail(f"message of {oid} holds an absolute path or a bare issue reference")
            msg_set.add(oid, body, "message", f"message {oid[:12]}")
        lines = [f"- {nblobs} reachable blobs ({len(blob_set.files)} text, {text} bytes), {len(msg_set.files)} commits"]
        lines += [f"- blobs: {c}" for c in scan(audit, "blobs", blob_set, scratch, pinned)]
        lines += [f"- messages: {c}" for c in scan(audit, "messages", msg_set, scratch, pinned)]
    return lines


def main():
    repo, report_dir, *allowlists = sys.argv[1:]
    if not allowlists:
        raise SystemExit("usage: audit.py <repo> <report-dir> <allowlist> [<allowlist> ...]")
    check_versions()
    audit = Audit(load_allowlist(allowlists))
    lines = scan_contents(repo, audit)

    added = git(repo, "log", "--all", "--diff-filter=A", "--name-only", "--format=").decode().split("\n")
    for path in sorted({p for p in added if p and SENSITIVE_NAME.search(p)}):
        audit.check(f"filename:{path}", "added path")
    idents = git(repo, "log", "--all", "--format=%an <%ae>%n%cn <%ce>").decode().splitlines()
    for ident, count in sorted(collections.Counter(idents).items()):
        lines.append(f"- identity `{ident}` × {count}")
        audit.check(f"identity:{ident}", "commit metadata")

    stale = sorted(audit.allow - audit.used)
    failed = bool(audit.untriaged or stale or audit.failures)
    lines.append(f"- untriaged: {len(audit.untriaged)}; unused allowlist entries: {len(stale)}; failures: {len(audit.failures)}")
    lines += [f"  - UNTRIAGED {key} ({where})" for key, where in sorted(audit.untriaged.items())]
    lines += [f"  - unused {key}" for key in stale]
    lines += [f"  - FAILED {reason}" for reason in audit.failures]
    lines.insert(0, f"# History audit — {'FAIL' if failed else 'PASS'}\n")
    with open(os.path.join(report_dir, "audit.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    print("\n".join(lines))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
