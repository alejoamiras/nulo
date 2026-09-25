"""Pre-push audit of an extracted history: secrets, absolute paths, filenames, identities, binaries.

Usage: audit.py <repo> <report-dir> <allowlist> [<allowlist> ...]

Every reachable blob is written to a scratch directory under its path and scanned there. That
covers content a merge resolution introduced as well as anything a diff would show, and each
scanner must report having read at least every text byte written, or the audit fails. A finding
is keyed by the SHA-256 of its value and reported only by location, so no candidate secret reaches
the report. Exits 1 on an untriaged finding, an unused allowlist entry, a scanner error or an
incomplete scan.
"""

import collections
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import threading

ABS_PATH = re.compile(
    rb"/Users/[A-Za-z0-9_]|/home/[A-Za-z0-9_]|/mnt/user-data/[A-Za-z0-9_]|(?<![\w./-])/root/|[A-Za-z]:(?:\\)+Users(?:\\)+"
)
BARE_ISSUE_REF = re.compile(rb"(?<![\w/#&])#\d+\b")
SENSITIVE_NAME = re.compile(r"(^|/)\.env($|\.)|\.pem$|keystore|key", re.IGNORECASE)
BINARY_OK = {".woff2", ".woff", ".ttf", ".otf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico"}
# trufflehog stops reading a line past 10 MiB without reporting it.
MAX_LINE = 10 * 1024 * 1024
# gitleaks' default config path-allowlists these; trufflehog, which has no path allowlist, must
# still read them, so each scanner is held to its own expected byte count.
GITLEAKS_SKIPS = re.compile(r"\.svg$", re.IGNORECASE)
ANSI = re.compile(r"\x1b\[[0-9;]*m")


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


def reachable_blobs(repo):
    first_path = {}
    for line in git(repo, "rev-list", "--objects", "--all").decode().splitlines():
        oid, _, path = line.partition(" ")
        first_path.setdefault(oid, path)
    checks = git(repo, "cat-file", "--batch-check=%(objecttype) %(objectname)", data="\n".join(first_path).encode())
    return [(line.split()[1], first_path[line.split()[1]]) for line in checks.decode().splitlines() if line.startswith("blob ")]


def blob_contents(repo, oids):
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


def materialize(repo, root, audit):
    """Writes every text blob to <root>/<oid>/<path>; records binaries, long lines and absolute paths."""
    blobs = reachable_blobs(repo)
    where = dict(blobs)
    total = gitleaks_skipped = 0
    for oid, data in blob_contents(repo, [oid for oid, _ in blobs]):
        path = where[oid]
        if ABS_PATH.search(data):
            audit.check(f"abspath:{path}:{oid[:12]}", f"blob {oid[:12]}")
        if b"\0" in data[:8192]:
            if os.path.splitext(path)[1].lower() not in BINARY_OK:
                audit.check(f"binary:{path}:{oid[:12]}", "not scanned: binary")
            continue
        if max((len(line) for line in data.split(b"\n")), default=0) > MAX_LINE:
            audit.fail(f"{path} (blob {oid[:12]}) has a line over {MAX_LINE} bytes, which trufflehog truncates")
        target = os.path.join(root, oid, path)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "wb") as fh:
            fh.write(data)
        total += len(data)
        if GITLEAKS_SKIPS.search(path):
            gitleaks_skipped += len(data)
    return len(blobs), {"gitleaks": total - gitleaks_skipped, "trufflehog": total}


def commit_messages(repo):
    raw = git(repo, "log", "--all", "--format=%H%x00%B%x01")
    for record in raw.split(b"\x01"):
        record = record.lstrip(b"\n")
        if record:
            sha, _, body = record.partition(b"\x00")
            yield sha.decode(), body


def run_gitleaks(target, label):
    proc = subprocess.run(
        ["gitleaks", "dir", target, "--no-banner", "--exit-code", "0", "--report-format", "json", "--report-path", "-"],
        capture_output=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"gitleaks ({label}) exited {proc.returncode}")
    findings = json.loads(proc.stdout)
    if not isinstance(findings, list):
        raise RuntimeError(f"gitleaks ({label}) did not report a JSON array")
    scanned = re.search(r"scanned ~(\d+) bytes", ANSI.sub("", proc.stderr.decode(errors="replace")))
    if not scanned:
        raise RuntimeError(f"gitleaks ({label}) reported no scanned byte count")
    return [(f["RuleID"], f["File"], int(f["StartLine"]), f["Secret"]) for f in findings], int(scanned.group(1))


def run_trufflehog(target, label):
    proc = subprocess.run(
        ["trufflehog", "filesystem", target, "--no-verification", "--json", "--no-update", "--fail-on-scan-errors"],
        capture_output=True,
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
    done = [json.loads(line) for line in proc.stderr.decode().splitlines() if '"finished scanning"' in line]
    if len(done) != 1 or "bytes" not in done[0]:
        raise RuntimeError(f"trufflehog ({label}) reported no finished-scanning summary")
    return findings, int(done[0]["bytes"])


def scan(audit, label, root, expected, locate):
    """Runs both scanners over <root>; each must have read at least its expected byte count."""
    counts = []
    for scanner, run in (("gitleaks", run_gitleaks), ("trufflehog", run_trufflehog)):
        findings, scanned = run(root, label)
        total = expected[scanner]
        if scanned < total:
            audit.fail(f"{scanner} ({label}) read {scanned} of {total} bytes")
        for rule, file, line, secret in findings:
            path, where = locate(os.path.relpath(file, root))
            digest = hashlib.sha256(secret.encode()).hexdigest()[:16]
            audit.check(f"secret:{scanner}:{rule}:{path}:{digest}", f"{where} line {line}")
        counts.append(f"{scanner} {len(findings)} finding(s), read {scanned} of {total} bytes")
    return counts


def locate_blob(rel):
    oid, _, path = rel.partition(os.sep)
    return path, f"blob {oid[:12]}"


def scan_contents(repo, audit):
    with tempfile.TemporaryDirectory() as scratch:
        blob_root, msg_root = os.path.join(scratch, "blobs"), os.path.join(scratch, "messages")
        os.makedirs(msg_root)
        nblobs, expected = materialize(repo, blob_root, audit)
        messages = list(commit_messages(repo))
        for sha, body in messages:
            if ABS_PATH.search(body) or BARE_ISSUE_REF.search(body):
                audit.fail(f"message of {sha} holds an absolute path or a bare issue reference")
            with open(os.path.join(msg_root, sha), "wb") as fh:
                fh.write(body)
        lines = [f"- {nblobs} reachable blobs ({expected['trufflehog']} text bytes), {len(messages)} commits"]
        lines += [f"- blobs: {c}" for c in scan(audit, "blobs", blob_root, expected, locate_blob)]
        msg_bytes = sum(len(body) for _, body in messages)
        msg_expected = {"gitleaks": msg_bytes, "trufflehog": msg_bytes}
        lines += [f"- messages: {c}" for c in scan(audit, "messages", msg_root, msg_expected, lambda rel: (rel, "message"))]
    return lines


def main():
    repo, report_dir, *allowlists = sys.argv[1:]
    if not allowlists:
        raise SystemExit("usage: audit.py <repo> <report-dir> <allowlist> [<allowlist> ...]")
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
